import { readFileSync } from "node:fs";
import { addBrowser } from "./layout.js";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: node tools/add-browser.js <layout.json>");
  process.exit(2);
}
try {
  process.stdout.write(JSON.stringify(addBrowser(JSON.parse(readFileSync(file, "utf8"))), null, 2) + "\n");
} catch (error) {
  console.error(`${file}: ${error.message}`);
  process.exit(1);
}
