package engine

import "fmt"

// FakeError builds a believable, generic error response used to deny feedback
// to a confirmed attacker. It must not reveal that detection happened (a bare
// "403 blocked by WAF" tells the agent its probe worked and to adapt). A 500
// that looks like an ordinary application fault is more useful: the attacker
// cannot tell a withheld success from a flaky endpoint.
func FakeError(route string) (int, []byte) {
	body := fmt.Sprintf(`{"error":"internal_error","message":"The request could not be completed. Please retry.","request_id":"req_%x"}`, hashRoute(route))
	return 500, []byte(body)
}

func hashRoute(s string) uint32 {
	var h uint32 = 2166136261
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}
