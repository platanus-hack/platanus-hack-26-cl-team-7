// Package extproc is the primary data plane: an Envoy external-processing
// (ext_proc) gRPC server that drives the shared engine. It is implemented in a
// follow-up step; this file keeps the build green and documents the shape.
package extproc

import (
	"errors"

	"github.com/platanus/ultimo-paso/internal/engine"
)

// Serve starts the ext_proc gRPC server on addr. Implemented next; until then
// the engine runs in -mode=revproxy.
func Serve(addr string, eng *engine.Engine) error {
	_ = eng
	return errors.New("extproc mode not yet wired; run with -mode=revproxy")
}
