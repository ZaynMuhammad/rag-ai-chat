package load

import (
	"context"
	"sync"
	"time"
)

type session struct {
	token     string
	expiresAt time.Time
	uses      []time.Time
}

type mintFunc func(ctx context.Context) (token string, expiresAt time.Time, err error)

type sessionPool struct {
	mint     mintFunc
	budget   int
	window   time.Duration
	mu       sync.Mutex
	sessions []*session
	minted   int
}

func newSessionPool(mint mintFunc, budget int, window time.Duration) *sessionPool {
	return &sessionPool{mint: mint, budget: budget, window: window}
}

func (p *sessionPool) prefill(ctx context.Context, count int) error {
	for range count {
		token, expiresAt, err := p.mint(ctx)
		if err != nil {
			return err
		}
		p.add(&session{token: token, expiresAt: expiresAt})
	}
	return nil
}

func (p *sessionPool) acquire(ctx context.Context) (string, error) {
	if token, ok := p.reuse(); ok {
		return token, nil
	}
	token, expiresAt, err := p.mint(ctx)
	if err != nil {
		return "", err
	}
	p.add(&session{token: token, expiresAt: expiresAt, uses: []time.Time{time.Now()}})
	return token, nil
}

func (p *sessionPool) reuse() (string, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	for _, s := range p.sessions {
		if s.take(now, p.budget, p.window) {
			return s.token, true
		}
	}
	return "", false
}

func (p *sessionPool) add(s *session) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sessions = append(p.sessions, s)
	p.minted++
}

func (p *sessionPool) mintedCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.minted
}

func (s *session) take(now time.Time, budget int, window time.Duration) bool {
	if !now.Add(window).Before(s.expiresAt) {
		return false
	}
	stale := 0
	for stale < len(s.uses) && !s.uses[stale].After(now.Add(-window)) {
		stale++
	}
	s.uses = s.uses[stale:]
	if len(s.uses) >= budget {
		return false
	}
	s.uses = append(s.uses, now)
	return true
}

func sessionsNeeded(plan []Request, budget int, window time.Duration) int {
	busiest, oldest := 0, 0
	for newest := range plan {
		for plan[newest].At-plan[oldest].At >= window {
			oldest++
		}
		busiest = max(busiest, newest-oldest+1)
	}
	return (busiest + budget - 1) / budget
}
