const allowedCommentDirective =
  /^\s*(eslint-|eslint\s|@ts-expect-error|@vitest-environment|prettier-ignore|global\s)/;

const noComments = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow code comments except tool directives",
    },
    messages: {
      noComments:
        "No code comments. Make the code explain itself with clear names and small functions. Tool directives such as eslint-disable or @ts-expect-error are allowed.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          if (allowedCommentDirective.test(comment.value)) continue;
          context.report({ loc: comment.loc, messageId: "noComments" });
        }
      },
    };
  },
};

export const ragPlugin = {
  meta: { name: "rag" },
  rules: {
    "no-comments": noComments,
  },
};
