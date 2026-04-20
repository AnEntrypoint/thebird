let stripPromise=null;
async function getStripper(){
  if(!stripPromise)stripPromise=import('https://esm.sh/sucrase@3.35.0/es2022/sucrase.mjs').then(m=>m.default||m).catch(()=>null);
  return stripPromise;
}

const typeDeclRE=/(^|\n)\s*(type|interface)\s+\w+[^\n]*(?:\n\s+[^\n]+)*\n?/g;
const asAnyRE=/\s+as\s+[\w.<>|&[\]]+/g;
const genericRE=/<[A-Z]\w*(?:\s*(?:extends|,)[^>]*)?>/g;
const varAnnotRE=/(\b(?:const|let|var)\s+\w+)\s*:\s*[^=,;)\n]+/g;
const paramAnnotRE=/(\b\w+)\s*:\s*[\w.<>|&[\]{} ]+?(?=\s*[,)=])/g;
const retTypeRE=/\)\s*:\s*[\w.<>|&[\]{} ]+?(?=\s*[{=]|$)/gm;

export function stripTypesSync(src){
  let out=src.replace(typeDeclRE,'\n').replace(asAnyRE,'').replace(genericRE,'');
  out=out.replace(varAnnotRE,'$1').replace(retTypeRE,')');
  return out;
}

export async function stripTypes(src,opts={}){
  try{const s=await getStripper();if(s?.transform){const r=s.transform(src,{transforms:['typescript',...(opts.jsx?['jsx']:[])],jsxRuntime:'automatic'});return r.code;}}catch{}
  return stripTypesSync(src);
}

export function isTsFile(filename){return/\.(ts|tsx|mts|cts)$/i.test(filename);}

export function preprocessSource(filename,src){
  if(!isTsFile(filename))return Promise.resolve(src);
  return stripTypes(src,{jsx:/\.tsx$/.test(filename)});
}
