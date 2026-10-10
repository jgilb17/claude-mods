const fs=require("fs"),os=require("os"),cp=require("child_process"),go=process.argv[2]==="go";
const f=process.env.CSV||os.homedir()+"/Library/Mobile Documents/com~apple~CloudDocs/repo-backups/branch-triage-2026-10-09.csv";
const rows=fs.readFileSync(f,"utf8").trim().split("\n").slice(1).map(l=>[...l.matchAll(/"((?:[^"]|"")*)"/g)].map(m=>m[1].replace(/""/g,'"')));
const todo=rows.filter(r=>r[1]==="retire: merged");let ok=0,kept=0;
for(const r of todo){const dir=os.homedir()+"/Projects/"+r[10];if(!go)continue;try{cp.execFileSync("git",["-C",dir,"branch","-D",r[2]],{stdio:"ignore"});ok++}catch{kept++}}
console.log(go?`deleted ${ok} merged branch names, kept ${kept} (checked out in a worktree or already gone)`:`dry run: ${todo.length} merged branches would be deleted: `+Object.entries(todo.reduce((o,r)=>(o[r[10]]=(o[r[10]]||0)+1,o),{})).map(([k,v])=>k+" "+v).join(", ")+". Nothing changed.");
