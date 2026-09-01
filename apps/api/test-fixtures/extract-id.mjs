// extract-id.mjs — read a JSON response from stdin and print the data.id
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(d);
    console.log(parsed.data?.id ?? "NO_ID");
  } catch (e) {
    console.log("PARSE_ERROR:" + d.slice(0, 200));
  }
});
