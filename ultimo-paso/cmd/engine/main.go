// Command engine runs the Último Paso feedback-denial data plane. It supports
// two modes sharing one engine package:
//
//	-mode=revproxy  (default) a Go reverse proxy that buffers and withholds
//	                evidential responses. The dependency-free fallback.
//	-mode=extproc   an Envoy external-processing gRPC server (see internal/extproc).
//
// Example:
//
//	engine -mode=revproxy -listen :8080 -upstream http://127.0.0.1:9001 \
//	       -events run.jsonl -canary aws=AKIA4ZQ7HN3XPLMB2KTE
package main

import (
	"encoding/json"
	"flag"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/platanus/ultimo-paso/internal/containment"
	"github.com/platanus/ultimo-paso/internal/engine"
	"github.com/platanus/ultimo-paso/internal/eventlog"
	"github.com/platanus/ultimo-paso/internal/extproc"
	"github.com/platanus/ultimo-paso/internal/research"
	"github.com/platanus/ultimo-paso/internal/revproxy"
)

type canaryFlags []string

func (c *canaryFlags) String() string { return strings.Join(*c, ",") }
func (c *canaryFlags) Set(v string) error {
	*c = append(*c, v)
	return nil
}

func main() {
	mode := flag.String("mode", "revproxy", "revproxy|extproc")
	listen := flag.String("listen", ":8080", "proxy listen address (revproxy) or gRPC address (extproc)")
	admin := flag.String("admin", ":8081", "admin HTTP address (rules, alerts, webhook sink)")
	upstream := flag.String("upstream", "http://127.0.0.1:9001", "upstream URL (revproxy)")
	decoy := flag.String("decoy", "", "decoy upstream URL for confirmed actors (optional)")
	events := flag.String("events", "", "event log JSONL path (default stdout)")
	webhook := flag.String("webhook", "", "alert webhook URL (default: this process's admin /webhook)")
	ttl := flag.Duration("ttl", 30*time.Minute, "containment rule TTL")
	researchOn := flag.Bool("research", false, "enable the L3 research loop")
	var canaries canaryFlags
	flag.Var(&canaries, "canary", "planted canary name=value (repeatable)")
	flag.Parse()

	sink, err := eventlog.Open(*events)
	if err != nil {
		log.Fatalf("event log: %v", err)
	}
	defer sink.Close()

	rules := engine.NewRuleStore(nil)

	// Build the engine first with a placeholder contain func; wire the real
	// manager after so research can reference the engine's rule store.
	var mgr *containment.Manager
	eng := engine.New(engine.Config{
		Events:  sink,
		Contain: func(in engine.ContainInput) { mgr.Handle(in) },
	})
	eng.Rules = rules

	var researcher containment.Researcher
	if *researchOn {
		researcher = research.New(rules, sink)
	}
	hookURL := *webhook
	if hookURL == "" {
		host := *admin
		if strings.HasPrefix(host, ":") {
			host = "127.0.0.1" + host
		}
		hookURL = "http://" + host + "/webhook"
	}
	mgr = containment.New(rules, hookURL, researcher, *ttl)

	for _, c := range canaries {
		if i := strings.IndexByte(c, '='); i > 0 {
			eng.Scanner.AddCanary(c[:i], c[i+1:])
			log.Printf("canary registered: %s", c[:i])
		}
	}

	go runAdmin(*admin, rules, mgr, eng)

	switch *mode {
	case "revproxy":
		p, err := revproxy.New(eng, *upstream, *decoy)
		if err != nil {
			log.Fatalf("revproxy: %v", err)
		}
		log.Printf("revproxy listening on %s -> %s (admin %s)", *listen, *upstream, *admin)
		log.Fatal(http.ListenAndServe(*listen, p))
	case "extproc":
		log.Printf("ext_proc gRPC listening on %s (admin %s)", *listen, *admin)
		log.Fatal(extproc.Serve(*listen, eng))
	default:
		log.Fatalf("unknown mode %q", *mode)
	}
}

func runAdmin(addr string, rules *engine.RuleStore, mgr *containment.Manager, eng *engine.Engine) {
	mux := http.NewServeMux()
	mux.HandleFunc("/rules", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, rules.Active())
	})
	mux.HandleFunc("/reset", func(w http.ResponseWriter, r *http.Request) {
		eng.Reset()
		log.Printf("[admin] engine state reset")
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/alerts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, mgr.Alerts())
	})
	mux.HandleFunc("/webhook", func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		log.Printf("[alert] %s", string(b))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Printf("admin server: %v", err)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
