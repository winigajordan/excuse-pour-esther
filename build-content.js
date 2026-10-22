// Chiffre content.txt avec la date du coffre et écrit content.js
//   node build-content.js            -> date par défaut 22/10/2026
//   node build-content.js 14/02/2027 -> autre date (jj/mm/aaaa)
// Même algorithme que unseal() dans script.js (SHA-256 en mode flux, sans WebCrypto).
const fs = require("fs");
const crypto = require("crypto");

const date = process.argv[2] || "22/10/2026";
if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) throw new Error("Format attendu : jj/mm/aaaa");

const sha = (b) => crypto.createHash("sha256").update(b).digest();
const salt = crypto.randomBytes(16);

let k = Buffer.concat([Buffer.from(date), salt]);
for (let i = 0; i < 20000; i++) k = sha(k);

const plain = Buffer.from("ESTHER|" + fs.readFileSync(__dirname + "/content.txt", "utf8"), "utf8");
const out = Buffer.alloc(plain.length);
for (let i = 0; i < plain.length; i += 32) {
  const ctr = Buffer.alloc(4); ctr.writeUInt32LE(i / 32);
  const ks = sha(Buffer.concat([k, ctr]));
  for (let j = 0; j < 32 && i + j < plain.length; j++) out[i + j] = plain[i + j] ^ ks[j];
}

fs.writeFileSync(
  __dirname + "/content.js",
  "window.SEALED = " + JSON.stringify({ salt: salt.toString("base64"), data: out.toString("base64") }) + ";\n"
);
console.log("content.js chiffré avec la date", date);
