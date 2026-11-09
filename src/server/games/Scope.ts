import { Schema } from "effect";
import type { SqlClient } from "effect/sql";

export const Year = Schema.Int.check(
  Schema.isBetween({ minimum: 1940, maximum: 2100 }),
);

export const Qid = Schema.String.check(Schema.isPattern(/^Q\d+$/));

const Label = Schema.String.check(Schema.isMaxLength(80));

export const Scope = Schema.Struct({
  region: Schema.optionalKey(Label),
  subRegion: Schema.optionalKey(Label),
  from: Schema.optionalKey(Year),
  to: Schema.optionalKey(Year),
  gameQid: Schema.optionalKey(Qid),
});
export type Scope = typeof Scope.Type;

const originConditions = (sql: SqlClient.SqlClient, scope: Scope) => [
  ...(scope.region === undefined ? [] : [sql`scoped.region = ${scope.region}`]),
  ...(scope.subRegion === undefined
    ? []
    : [sql`scoped.sub_region = ${scope.subRegion}`]),
];

export const scopeConditions = (sql: SqlClient.SqlClient, scope: Scope) => {
  const origins = originConditions(sql, scope);
  return [
    ...(scope.gameQid === undefined ? [] : [sql`games.qid = ${scope.gameQid}`]),
    ...(scope.from === undefined
      ? []
      : [sql`games.release_year >= ${scope.from}`]),
    ...(scope.to === undefined ? [] : [sql`games.release_year <= ${scope.to}`]),
    ...(origins.length === 0
      ? []
      : [
          sql`EXISTS (
            SELECT 1 FROM origins AS scoped
            WHERE scoped.game_qid = games.qid AND ${sql.and(origins)}
          )`,
        ]),
  ];
};
