package containment

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/platanus/ultimo-paso/internal/engine"
)

type eventRecorder []engine.Event

func (rec *eventRecorder) Emit(event engine.Event) { *rec = append(*rec, event) }

func TestRuleSurvivesFailedAlertAndExpires(t *testing.T) {
	now := time.Now()
	rules := engine.NewRuleStore(func() time.Time { return now })
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer hook.Close()

	var events eventRecorder
	manager := New(rules, hook.URL, nil, time.Minute).WithEvents(&events)
	manager.Handle(engine.ContainInput{IncidentID: "incident", ObservedAt: now, ActorID: "actor",
		Route: "/litoral/receipt", Request: &engine.Request{TraceID: "trace", Method: "GET"}})

	if len(events) != 3 || events[0].Kind != "rule_installed" || events[1].Kind != "alert_created" ||
		events[2].Kind != "alert_delivery" || events[2].Reason != "failed-http-503" {
		t.Fatalf("unexpected event sequence: %+v", events)
	}
	for _, event := range events {
		if event.TraceID != "trace" || event.IncidentID != "incident" || event.RuleID != "contain-1" {
			t.Fatalf("event is missing trace context: %+v", event)
		}
	}
	if rules.Match("actor", "/litoral/receipt") == nil ||
		rules.Match("actor", "/litoral/service") != nil || rules.Match("other", "/litoral/receipt") != nil {
		t.Fatal("containment scope was not preserved")
	}
	now = *events[0].ExpiresAt
	if rules.Match("actor", "/litoral/receipt") != nil {
		t.Fatal("rule remained active at expiry")
	}
}
