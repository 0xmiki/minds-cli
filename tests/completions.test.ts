import assert from "node:assert/strict";
import test from "node:test";
import { completionScript } from "../src/completions.ts";

test("prints dynamic mind completion for supported shells", () => {
  assert.match(completionScript("bash"), /minds list/);
  assert.match(completionScript("bash"), /Nikola_Tesla/);
  assert.match(completionScript("bash"), /Aristotle/);
  assert.match(completionScript("bash"), /complete -F _minds_completion minds/);
  assert.match(completionScript("zsh"), /compdef _minds minds/);
  assert.match(completionScript("fish"), /__minds_ids/);
});

test("rejects an unknown completion shell", () => {
  assert.throws(() => completionScript("powershell"), /minds completions <bash\|zsh\|fish>/);
});
