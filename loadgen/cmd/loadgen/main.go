package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/ZaynMuhammad/rag-ai-chat/loadgen/internal/load"
)

const (
	chatsPerSession            = 8
	sessionWindow              = time.Minute
	idleBeforeNodeKeepAliveEnd = 4 * time.Second
)

var (
	errUsage    = errors.New("usage: loadgen steady|spike|zipf [flags], see loadgen <scenario> -h")
	errScenario = errors.New("invalid scenario")
)

type options struct {
	baseURL     string
	rate        float64
	duration    time.Duration
	timeout     time.Duration
	seed        uint64
	poisson     bool
	maxInFlight int
	questions   string
	bucket      time.Duration
	json        bool
	multiplier  float64
	spikeAt     time.Duration
	spikeFor    time.Duration
	exponent    float64
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	err := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errUsage
	}
	scenario := args[0]
	opts, err := parse(scenario, args[1:], stderr)
	if err != nil {
		return err
	}
	questions, err := load.LoadQuestions(os.DirFS(opts.questions))
	if err != nil {
		return fmt.Errorf("load questions from %s: %w", opts.questions, err)
	}
	plan, description := buildPlan(scenario, &opts, questions)
	transport := &http.Transport{MaxIdleConnsPerHost: 1024, IdleConnTimeout: idleBeforeNodeKeepAliveEnd}
	defer transport.CloseIdleConnections()
	_, _ = fmt.Fprintf(stderr, "%s: %d chats against %s\n", description, len(plan), opts.baseURL)
	result, err := load.Run(ctx, &load.Config{
		BaseURL:       opts.baseURL,
		Plan:          plan,
		Timeout:       opts.timeout,
		MaxInFlight:   opts.maxInFlight,
		Client:        &http.Client{Transport: transport},
		SessionBudget: chatsPerSession,
		SessionWindow: sessionWindow,
	})
	if err != nil {
		return fmt.Errorf("run %s: %w", scenario, err)
	}
	summary := load.Summarize(description, &result, opts.bucket)
	if opts.json {
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(summary); err != nil {
			return fmt.Errorf("write json: %w", err)
		}
		return nil
	}
	return summary.WriteTable(stdout)
}

func parse(scenario string, args []string, stderr io.Writer) (options, error) {
	flags := flag.NewFlagSet(scenario, flag.ContinueOnError)
	flags.SetOutput(stderr)
	var opts options
	flags.StringVar(&opts.baseURL, "url", "http://localhost:3000", "gateway base URL")
	flags.Float64Var(&opts.rate, "rate", 4, "chats per second")
	flags.DurationVar(&opts.duration, "duration", time.Minute, "how long to send for")
	flags.DurationVar(&opts.timeout, "timeout", 30*time.Second, "give up on a chat this long after it was due")
	flags.Uint64Var(&opts.seed, "seed", 1, "seed for Poisson arrivals and Zipf picks")
	flags.BoolVar(&opts.poisson, "poisson", false, "exponential gaps between arrivals instead of a fixed interval")
	flags.IntVar(&opts.maxInFlight, "max-inflight", 0, "cap concurrent chats like a fixed pool, 0 for none")
	flags.StringVar(&opts.questions, "questions", "evals/games", "directory of frozen *.jsonl eval questions")
	flags.DurationVar(&opts.bucket, "bucket", 5*time.Second, "width of the time buckets in the report")
	flags.BoolVar(&opts.json, "json", false, "print the summary as JSON")
	switch scenario {
	case "steady":
	case "spike":
		flags.Float64Var(&opts.multiplier, "multiplier", 5, "burst rate as a multiple of -rate")
		flags.DurationVar(&opts.spikeAt, "spike-at", 20*time.Second, "when the burst starts")
		flags.DurationVar(&opts.spikeFor, "spike-for", 10*time.Second, "how long the burst lasts")
	case "zipf":
		flags.Float64Var(&opts.exponent, "s", 1, "Zipf exponent: question at rank k is asked with weight 1/k^s")
	default:
		return opts, fmt.Errorf("%w %q: %w", errScenario, scenario, errUsage)
	}
	if err := flags.Parse(args); err != nil {
		return opts, fmt.Errorf("parse flags: %w", err)
	}
	if err := validate(scenario, &opts); err != nil {
		return opts, err
	}
	return opts, nil
}

func validate(scenario string, opts *options) error {
	switch {
	case opts.rate <= 0 || opts.duration <= 0 || opts.timeout <= 0:
		return fmt.Errorf("%w: -rate, -duration and -timeout must be positive", errScenario)
	case opts.maxInFlight < 0:
		return fmt.Errorf("%w: -max-inflight must not be negative", errScenario)
	case scenario == "spike" && !burstFits(opts):
		return fmt.Errorf("%w: the burst must have a positive multiplier and fit inside -duration", errScenario)
	case scenario == "zipf" && opts.exponent < 0:
		return fmt.Errorf("%w: -s must not be negative", errScenario)
	default:
		return nil
	}
}

func burstFits(opts *options) bool {
	return opts.multiplier > 0 && opts.spikeAt >= 0 && opts.spikeFor > 0 && opts.spikeAt+opts.spikeFor <= opts.duration
}

func buildPlan(scenario string, opts *options, questions []string) (plan []load.Request, description string) {
	segments := load.Steady(opts.rate, opts.duration)
	description = fmt.Sprintf("%s %g/s for %s", scenario, opts.rate, opts.duration)
	if scenario == "spike" {
		segments = load.Spike(opts.rate, opts.multiplier, opts.spikeAt, opts.spikeFor, opts.duration)
		description += fmt.Sprintf(", %gx from %s for %s", opts.multiplier, opts.spikeAt, opts.spikeFor)
	}
	var arrivals *rand.Rand
	if opts.poisson {
		arrivals = load.Seeded(opts.seed, load.ArrivalStream)
		description += fmt.Sprintf(", poisson seed %d", opts.seed)
	}
	pick := load.RoundRobin(questions)
	if scenario == "zipf" {
		pick = load.Zipf(questions, opts.exponent, load.Seeded(opts.seed, load.QuestionStream))
		description += fmt.Sprintf(", zipf s=%g seed %d", opts.exponent, opts.seed)
	}
	if opts.maxInFlight > 0 {
		description += fmt.Sprintf(", at most %d in flight", opts.maxInFlight)
	}
	return load.Plan(load.Arrivals(segments, arrivals), pick), description
}
