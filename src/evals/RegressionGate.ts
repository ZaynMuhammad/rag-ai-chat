export type GroupResults = Readonly<
  Record<string, Readonly<Record<string, number | null>>>
>;

export interface GateOptions {
  readonly tolerance: number;
  readonly minimumQuestions: number;
  readonly lowerIsBetter: ReadonlySet<string>;
  readonly ungated: ReadonlySet<string>;
}

export interface Regression {
  readonly group: string;
  readonly metric: string;
  readonly baseline: number | null;
  readonly fresh: number | null;
}

const epsilon = 1e-9;

export const regressions = (
  baseline: GroupResults,
  fresh: GroupResults,
  options: GateOptions,
): ReadonlyArray<Regression> =>
  Object.entries(baseline).flatMap(
    ([group, before]): ReadonlyArray<Regression> => {
      const after = fresh[group];
      const questions = before["questions"] ?? 0;
      if (after === undefined) {
        return [
          { group, metric: "questions", baseline: questions, fresh: null },
        ];
      }
      if (after["questions"] !== questions) {
        return [
          {
            group,
            metric: "questions",
            baseline: questions,
            fresh: after["questions"] ?? null,
          },
        ];
      }
      if (questions < options.minimumQuestions) return [];
      return Object.entries(before).flatMap(
        ([metric, was]): ReadonlyArray<Regression> => {
          if (was === null || options.ungated.has(metric)) return [];
          const now = after[metric] ?? null;
          if (now === null)
            return [{ group, metric, baseline: was, fresh: now }];
          const drop = options.lowerIsBetter.has(metric)
            ? now - was
            : was - now;
          return drop > options.tolerance + epsilon
            ? [{ group, metric, baseline: was, fresh: now }]
            : [];
        },
      );
    },
  );
