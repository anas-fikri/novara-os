const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
rl.on("SIGINT", () => {
  if (rl.line === "") {
    console.log("\nCtrl+C pressed on empty line. Clearing screen...");
    console.clear();
    rl.prompt();
  } else {
    // clear current line
    rl.write(null, {ctrl: true, name: 'u'});
  }
});
rl.question("Prompt: ", (ans) => {
  console.log("Got: " + ans);
  rl.close();
});
