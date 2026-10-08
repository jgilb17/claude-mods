// Inserts claude-md-rule.md into a CLAUDE.md once, as its own paragraph just before the first
// "## " heading (or at the end if there is none). Running it again changes nothing.
// Usage: node insert-rule.js <CLAUDE.md> <rule.md>
const fs = require('fs')
const [file, ruleFile] = process.argv.slice(2)
const rule = fs.readFileSync(ruleFile, 'utf8').trim()
const s = fs.readFileSync(file, 'utf8')
if (s.includes('MOD COMMANDS.')) { console.log('already present:', file); process.exit(0) }
const lines = s.split('\n')
const at = lines.findIndex(l => l.startsWith('## '))
const out = at === -1 ? s.replace(/\s*$/, '\n\n' + rule + '\n') : [...lines.slice(0, at), rule, '', ...lines.slice(at)].join('\n')
fs.writeFileSync(file, out)
console.log(`inserted ${rule.length} characters into ${file}${at === -1 ? ' at the end' : ' before line ' + (at + 1)}`)
