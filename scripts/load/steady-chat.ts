import { evalQuestions, runChatLoad } from "./ChatLoad";

await runChatLoad(
  "steady",
  (index) => evalQuestions[index % evalQuestions.length] ?? "",
);
