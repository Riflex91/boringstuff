// O52: independent origin / binding proof for the actual O45 guard call.
// Merely spelling a familiar function name and any "legacy-..." string as
// the first statement is NOT proof. This intentionally rejects ambiguous
// lexical shadowing; it is a bounded static check, not whole-program proof.
const GUARDED_OPERATIONS=Object.freeze({
  'world-branch-bootstrap.mjs':'legacy-code-bootstrap',
  'world-next-inactive-restage.mjs':'legacy-inactive-restage',
  'world-next-separate-inactive-stage.mjs':'legacy-separate-stage',
  'world-next-place-spawn.mjs':'legacy-spawn-placement',
  'world-next-activate-spawn.mjs':'legacy-spawn-activation',
  'world-first-spawn.mjs':'legacy-first-spawn'
});
const IDENT='assertLegacyWorldMutationDisabled';
const MODULE='./o45-world-mutation-entrypoint-hold.mjs';
function hasBinding(pattern,name){
  if(!pattern||typeof pattern!=='object')return false;
  if(pattern.type==='Identifier')return pattern.name===name;
  if(pattern.type==='AssignmentPattern')return hasBinding(pattern.left,name);
  if(pattern.type==='RestElement')return hasBinding(pattern.argument,name);
  if(pattern.type==='ArrayPattern')return pattern.elements.some(x=>hasBinding(x,name));
  if(pattern.type==='ObjectPattern')return pattern.properties.some(p=>
    p.type==='RestElement'?hasBinding(p.argument,name):
      hasBinding(p.value,name));
  return false;
}
function visit(node,cb){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)visit(item,cb);return;}
  if(typeof node.type!=='string')return;
  cb(node);
  for(const [k,v] of Object.entries(node)){
    if(['loc','range','start','end'].includes(k))continue;
    if(v&&typeof v==='object')visit(v,cb);
  }
}
function hasLocalShadow(fn){
  if((fn.params||[]).some(p=>hasBinding(p,IDENT)))return true;
  let shadow=false;
  visit(fn.body,n=>{
    if(n.type==='VariableDeclarator'&&hasBinding(n.id,IDENT))shadow=true;
    if(['FunctionDeclaration','ClassDeclaration'].includes(n.type)&&
       n.id?.name===IDENT)shadow=true;
    if(n.type==='CatchClause'&&hasBinding(n.param,IDENT))shadow=true;
    if(['ArrowFunctionExpression','FunctionExpression'].includes(n.type)&&
       (n.params||[]).some(p=>hasBinding(p,IDENT)))shadow=true;
  });
  return shadow;
}
// O53: JS evaluates default initializers and destructuring *before*
// entering the function body. A first-statement throw cannot protect them.
// The only existing reviewed default is a zero-argument empty callback
// factory (onPhase=()=>{}), whose creation does not invoke user code.
function safePreBodyParameter(parameter) {
  if(parameter?.type==='Identifier')return true;
  if(parameter?.type!=='AssignmentPattern'||
     parameter.left?.type!=='Identifier')return false;
  const value=parameter.right;
  return value?.type==='ArrowFunctionExpression'&&value.async===false&&
    value.expression===false&&value.params?.length===0&&
    value.body?.type==='BlockStatement'&&value.body.body?.length===0;
}
function safePreBodyParameters(fn,isMain) {
  const parameters=fn?.params;
  if(!Array.isArray(parameters))return false;
  if(isMain&&parameters.length!==0)return false;
  return parameters.every(safePreBodyParameter);
}

function actualGuard(statement,expected){
  if(statement?.type!=='ExpressionStatement')return false;
  const call=statement.expression;
  return call?.type==='CallExpression'&&call.optional!==true&&
    call.callee?.type==='Identifier'&&call.callee.name===IDENT&&
    call.arguments?.length===1&&
    call.arguments[0]?.type==='Literal'&&
    call.arguments[0].value===expected;
}
export function validateWorldGuardProvenance(ast,filename,exportNames){
  const expected=GUARDED_OPERATIONS[filename];
  if(!expected)return [];
  const violations=[];
  const imports=ast.body.filter(s=>s.type==='ImportDeclaration').flatMap(s=>
    (s.specifiers||[]).filter(p=>p.local?.name===IDENT)
      .map(p=>({source:s.source.value,kind:p.type,imported:p.imported?.name})));
  if(imports.length!==1||imports[0].source!==MODULE||
     imports[0].kind!=='ImportSpecifier'||imports[0].imported!==IDENT)
    violations.push('GUARD_NOT_TRUSTED_NAMED_IMPORT');
  const targets=[
    ...exportNames.map(name=>({name,exported:true})),
    {name:'main',exported:false}
  ];
  for(const item of targets){
    const matches=ast.body.flatMap(s=>{
      if(item.exported&&s.type==='ExportNamedDeclaration'&&
         s.declaration?.type==='FunctionDeclaration'&&
         s.declaration.id?.name===item.name)return [s.declaration];
      if(!item.exported&&s.type==='FunctionDeclaration'&&
         s.id?.name===item.name)return [s];
      return [];
    });
    if(matches.length!==1){
      violations.push('GUARD_TARGET_AMBIGUOUS_'+item.name);
      continue;
    }
    const fn=matches[0];
    if(!actualGuard(fn.body?.body?.[0],expected))
      violations.push('GUARD_WRONG_OPERATION_OR_ORDER_'+item.name);
    if(hasLocalShadow(fn))
      violations.push('GUARD_BINDING_SHADOWED_'+item.name);
    if(!safePreBodyParameters(fn,item.name==='main'))
      violations.push('GUARD_PREBODY_PARAMETER_EFFECT_OR_DESTRUCTURE_'+item.name);
  }
  return violations;
}
export const WORLD_GUARD_OPERATION_NAMES=GUARDED_OPERATIONS;
