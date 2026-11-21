// Package extproc is the primary data plane: an Envoy external-processing
// (ext_proc) gRPC server that drives the shared engine. Envoy is configured to
// send request headers+body and response headers+body in BUFFERED mode (see
// deploy/envoy.yaml), so the engine sees whole bodies and can withhold or
// replace an evidential response cleanly before Envoy sends anything downstream.
// This is the realistic, "drops into Istio" placement; internal/revproxy is the
// dependency-free fallback that runs the same engine.
package extproc

import (
	"io"
	"net"
	"strconv"
	"strings"

	corev3 "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	extprocv3 "github.com/envoyproxy/go-control-plane/envoy/service/ext_proc/v3"
	typev3 "github.com/envoyproxy/go-control-plane/envoy/type/v3"
	"google.golang.org/grpc"

	"github.com/platanus/ultimo-paso/internal/engine"
)

type server struct {
	extprocv3.UnimplementedExternalProcessorServer
	eng *engine.Engine
}

// Serve starts the ext_proc gRPC server on addr.
func Serve(addr string, eng *engine.Engine) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	gs := grpc.NewServer(grpc.MaxRecvMsgSize(4 << 20))
	extprocv3.RegisterExternalProcessorServer(gs, &server{eng: eng})
	return gs.Serve(lis)
}

// phase identifies which ext_proc message a continue reply answers.
type phase int

const (
	phReqHeaders phase = iota
	phReqBody
	phRespHeaders
	phRespBody
)

// streamState carries one transaction across the ext_proc message sequence.
type streamState struct {
	er       *engine.Request
	dec      engine.RequestDecision
	decided  bool
	expBody  bool
	respSt   int
	respHdrs map[string]string
	respCT   string
}

func (s *server) Process(stream extprocv3.ExternalProcessor_ProcessServer) error {
	st := &streamState{respHdrs: map[string]string{}}
	for {
		req, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		var resp *extprocv3.ProcessingResponse
		switch v := req.Request.(type) {
		case *extprocv3.ProcessingRequest_RequestHeaders:
			resp = s.onReqHeaders(st, v.RequestHeaders)
		case *extprocv3.ProcessingRequest_RequestBody:
			resp = s.onReqBody(st, v.RequestBody)
		case *extprocv3.ProcessingRequest_ResponseHeaders:
			resp = s.onRespHeaders(st, v.ResponseHeaders)
		case *extprocv3.ProcessingRequest_ResponseBody:
			resp = s.onRespBody(st, v.ResponseBody)
		default:
			resp = cont(phReqHeaders)
		}
		if err := stream.Send(resp); err != nil {
			return err
		}
	}
}

func (s *server) onReqHeaders(st *streamState, h *extprocv3.HttpHeaders) *extprocv3.ProcessingResponse {
	m := headerMap(h)
	path := m[":path"]
	rawQuery := ""
	if i := strings.IndexByte(path, '?'); i >= 0 {
		rawQuery = path[i+1:]
		path = path[:i]
	}
	st.er = &engine.Request{
		Method:    m[":method"],
		Path:      path,
		RawQuery:  rawQuery,
		Headers:   m,
		RemoteIP:  clientIP(m),
		UserAgent: m["user-agent"],
		Cookie:    sessionCookie(m["cookie"]),
		Route:     path,
	}
	st.expBody = !h.EndOfStream && hasBody(m)
	if !st.expBody {
		if blocked := s.decide(st); blocked != nil {
			return blocked
		}
	}
	return cont(phReqHeaders)
}

func (s *server) onReqBody(st *streamState, b *extprocv3.HttpBody) *extprocv3.ProcessingResponse {
	if st.er != nil {
		st.er.Body = b.Body
	}
	if blocked := s.decide(st); blocked != nil {
		return blocked
	}
	return cont(phReqBody)
}

// decide runs OnRequest once; returns an immediate (block/divert) response or
// nil to continue.
func (s *server) decide(st *streamState) *extprocv3.ProcessingResponse {
	if st.decided || st.er == nil {
		return nil
	}
	st.dec = s.eng.OnRequest(st.er)
	st.decided = true
	switch st.dec.Action {
	case engine.Block, engine.Divert:
		status, body := engine.FakeError(st.er.Route)
		return immediate(status, body)
	default:
		return nil
	}
}

func (s *server) onRespHeaders(st *streamState, h *extprocv3.HttpHeaders) *extprocv3.ProcessingResponse {
	m := headerMap(h)
	st.respHdrs = m
	st.respSt, _ = strconv.Atoi(m[":status"])
	st.respCT = m["content-type"]
	if h.EndOfStream {
		return s.scanAndRespond(st, nil, phRespHeaders)
	}
	return cont(phRespHeaders)
}

func (s *server) onRespBody(st *streamState, b *extprocv3.HttpBody) *extprocv3.ProcessingResponse {
	return s.scanAndRespond(st, b.Body, phRespBody)
}

func (s *server) scanAndRespond(st *streamState, body []byte, ph phase) *extprocv3.ProcessingResponse {
	if st.er == nil {
		return cont(ph)
	}
	eresp := &engine.Response{Status: st.respSt, Headers: st.respHdrs, Body: body, ContentType: st.respCT}
	sd := s.eng.OnResponse(st.er, eresp, st.dec)

	var finalBody []byte
	replace := sd.Action == engine.RespReplace
	if replace {
		finalBody = sd.Body
	} else {
		finalBody = eresp.Body // may carry an injected trap
	}

	if !replace && string(finalBody) == string(body) {
		return cont(ph)
	}

	setHeaders := []*corev3.HeaderValueOption{hv("content-length", strconv.Itoa(len(finalBody)))}
	if replace {
		setHeaders = append(setHeaders, hv(":status", strconv.Itoa(sd.Status)), hv("content-type", "application/json"))
	}
	common := &extprocv3.CommonResponse{
		Status:         extprocv3.CommonResponse_CONTINUE,
		HeaderMutation: &extprocv3.HeaderMutation{SetHeaders: setHeaders, RemoveHeaders: []string{"content-encoding"}},
		BodyMutation:   &extprocv3.BodyMutation{Mutation: &extprocv3.BodyMutation_Body{Body: finalBody}},
	}
	if ph == phRespBody {
		return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_ResponseBody{
			ResponseBody: &extprocv3.BodyResponse{Response: common}}}
	}
	return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_ResponseHeaders{
		ResponseHeaders: &extprocv3.HeadersResponse{Response: common}}}
}

// --- helpers ---

func headerMap(h *extprocv3.HttpHeaders) map[string]string {
	m := map[string]string{}
	if h == nil || h.Headers == nil {
		return m
	}
	for _, hdr := range h.Headers.Headers {
		val := hdr.Value
		if val == "" && len(hdr.RawValue) > 0 {
			val = string(hdr.RawValue)
		}
		m[strings.ToLower(hdr.Key)] = val
	}
	return m
}

func hasBody(m map[string]string) bool {
	switch m[":method"] {
	case "POST", "PUT", "PATCH", "DELETE":
		return m["content-length"] != "0"
	}
	return false
}

func clientIP(m map[string]string) string {
	if xff := m["x-forwarded-for"]; xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	return m["x-envoy-external-address"]
}

func sessionCookie(cookie string) string {
	for _, p := range strings.Split(cookie, ";") {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, "session=") {
			return strings.TrimPrefix(p, "session=")
		}
	}
	return ""
}

func hv(key, value string) *corev3.HeaderValueOption {
	return &corev3.HeaderValueOption{Header: &corev3.HeaderValue{Key: key, RawValue: []byte(value)}}
}

func contCommon() *extprocv3.CommonResponse {
	return &extprocv3.CommonResponse{Status: extprocv3.CommonResponse_CONTINUE}
}

func cont(ph phase) *extprocv3.ProcessingResponse {
	switch ph {
	case phReqBody:
		return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_RequestBody{
			RequestBody: &extprocv3.BodyResponse{Response: contCommon()}}}
	case phRespHeaders:
		return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_ResponseHeaders{
			ResponseHeaders: &extprocv3.HeadersResponse{Response: contCommon()}}}
	case phRespBody:
		return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_ResponseBody{
			ResponseBody: &extprocv3.BodyResponse{Response: contCommon()}}}
	default:
		return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_RequestHeaders{
			RequestHeaders: &extprocv3.HeadersResponse{Response: contCommon()}}}
	}
}

func immediate(status int, body []byte) *extprocv3.ProcessingResponse {
	return &extprocv3.ProcessingResponse{Response: &extprocv3.ProcessingResponse_ImmediateResponse{
		ImmediateResponse: &extprocv3.ImmediateResponse{
			Status:  &typev3.HttpStatus{Code: typev3.StatusCode(status)},
			Headers: &extprocv3.HeaderMutation{SetHeaders: []*corev3.HeaderValueOption{hv("content-type", "application/json")}},
			Body:    body,
			Details: "ultimo-paso-feedback-denial",
		}}}
}
