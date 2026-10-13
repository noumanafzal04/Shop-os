// A walk is a script like this one: copy it, name it after its phase, run it with
//   node e2e/qa-kit/<name>.mjs
// and paste what it printed into the log in docs/qa/SYSTEM-TEST.md.
import { open, textOf } from "./kit.mjs";

const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "example" });
try {
  qa.step("the dashboard");
  await qa.page.goto("/tenant");
  await qa.quiet();
  await qa.shot("dashboard");
  console.log((await textOf(qa.page)).slice(0, 600));

  qa.step("what the server says");
  const today = await qa.ask("/dashboard");
  console.log("GET /dashboard →", today.status);

  console.log(qa.report());
} finally {
  await qa.close();
}
