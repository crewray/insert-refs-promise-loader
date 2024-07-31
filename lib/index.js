const { parseComponent, compile } = require("vue-template-compiler");
const babelParser = require("@babel/parser");
const babelTraverse = require("@babel/traverse").default;
const babelGenerator = require("@babel/generator").default;
const t = require("@babel/types");
const fs = require("fs");
const path = require("path");

function addPropToProps(propsNode, newProp) {
  const newPropNode = babelParser.parseExpression(newProp).properties[0];
  if (propsNode.value.properties.find((p) => p.key.name === "asyncLoadProp")) {
    return; // 已经存在，不处理
  }
  propsNode.value.properties.unshift(newPropNode);
}

function modifyTemplateAST(node) {
  if (node.type === 1) {
    const hasRef = node.attrsMap.ref;

    if (hasRef) {
      node.attrsList.push({ name: ":asyncLoadProp", value: "asyncLoad" });
      node.attrsMap[":asyncLoadProp"] = "asyncLoad";
    }
  }

  if (node.children && node.children.length > 0) {
    node.children.forEach(modifyTemplateAST);
  }
}

function astToTemplate(ast) {
  if (!ast) return "";
  if (ast.type === 3) return ast.text; // 文本节点

  let template = `<${ast.tag}`;

  // 添加属性
  ast.attrsList.forEach((attr) => {
    template += ` ${attr.name}="${attr.value}"`;
  });

  template += ">";

  // 添加子节点
  if (ast.children) {
    ast.children.forEach((child) => {
      template += astToTemplate(child);
    });
  }

  template += `</${ast.tag}>`;

  return template;
}

module.exports = function (source) {
  try {
    const options = this.query;
    const subPacks = options.subPacks || [];
    const pages = options.pages || [];
    // 是否在subPacks中
    const isInSubPacks =
      subPacks.length === 0 ||
      subPacks.some((includePath) => {
        const absoluteIncludePath = path.resolve(includePath);
        return resourcePath.startsWith(absoluteIncludePath);
      });
    // 是否在pages中
    const isInPages =
      pages.length === 0 ||
      pages.some((includePath) => {
        const absoluteIncludePath = path.resolve(includePath);
        return resourcePath.startsWith(absoluteIncludePath);
      });

    const component = parseComponent(source);
    const script = component.script ? component.script.content : null;
    const template = component.template ? component.template.content : null;

    if (!script && !template) {
      return source; // 没有脚本内容，直接返回原始代码
    }

    const ast = babelParser.parse(script, {
      sourceType: "module",
      plugins: ["jsx"],
      attachComment: true,
    });
    if (isInPages) {
      const visited = new Set();
      babelTraverse(ast, {
        MemberExpression(path) {
          if (path.node.property.name === "$refs") {
            const functionPath = path.getFunctionParent();
            if (functionPath && !functionPath.node.async) {
              functionPath.node.async = true;
            }
            const blockPath = path.findParent((p) => p.isBlockStatement());
            if (blockPath && !visited.has(blockPath)) {
              visited.add(blockPath); // 标记节点为已访问
              const timestamp = new Date().getTime();
              let promiseCode = `
                      let promise_${timestamp} = new Promise((resolve, reject) => {
                          this.asyncLoad = resolve;
                      });
                      await promise_${timestamp};
                    `;

              const promiseNode = babelParser.parse(promiseCode, {
                sourceType: "module",
              }).program.body;
              blockPath.node.body.unshift(...promiseNode);
            }
          }
        },
      });

      //   var modifiedTemplate = template?.replace(/(<[a-zA-Z]+[^>]*ref="[\w]+"[^>]*)(>)/g, (match, p1, p2) => {
      //     return p1 + ` asyncLoadProp="asyncLoad"${p2}`;
      //   });
      ast.program.body.forEach((node) => {
        if (node.type === "ExportDefaultDeclaration") {
          const dataNode = node.declaration.properties.find((p) => p.key.name === "data");
          if (dataNode) {
            // const data = dataNode.value.properties[0];
            const newData = babelParser.parseExpression(`{
                          asyncLoad:()=>{}
                      }`).properties[0];
            dataNode.body.body.find((item) => item.type == "ReturnStatement").argument.properties.unshift(newData);
          } else {
            const dataCode = `{
                  data(){
                      return {
                          asyncLoad:()=>{}
                      }
                  }
              }`;
            const dataNode = babelParser.parseExpression(dataCode).properties[0];
            node.declaration.properties.unshift(dataNode);
          }
        }
      });
    }
    if (isInSubPacks) {
      const newProp = `{
        asyncLoadProp:{
          type:Function,
          default:()=>{}
        }
      }`;
      const newWatch = `{
            asyncLoadProp:{
                handler(val){
                    val()
                }
            }
        }`;
      ast.program.body.forEach((node) => {
        if (node.type === "ExportDefaultDeclaration") {
          let props = node.declaration.properties.find((p) => p.key.name === "props");
          if (props) {
            addPropToProps(props, newProp);
          } else {
            const propsCode = `{
                props:{
                    asyncLoadProp:{
                        type:Function,
                        default:()=>{}
                    }
                }
            }`;
            const propsNode = babelParser.parseExpression(propsCode).properties[0];
            node.declaration.properties.unshift(propsNode);
          }
          let watch = node.declaration.properties.find((p) => p.key.name === "watch");
          if (watch) {
            watch.value.properties.unshift(...babelParser.parseExpression(newWatch).properties);
          } else {
            const watchCode = `{
                watch:{
                    asyncLoadProp:{
                        handler(val){
                            val()
                        }
                    }
                }
            }`;
            const watchNode = babelParser.parseExpression(watchCode).properties[0];
            node.declaration.properties.unshift(watchNode);
          }
          let mounted = node.declaration.properties.find((p) => p.key.name === "mounted");
          if (mounted) {
            const mountedCode = `this.asyncLoadProp&&this.asyncLoadProp();`;
            const mountedNode = babelParser.parse(mountedCode, {
              sourceType: "module",
            }).program.body;
            mounted.body.body.unshift(...mountedNode);
          } else {
            const mountedCode = `{
                mounted(){
                    this.asyncLoadProp&&this.asyncLoadProp();
                }
            }`;
            const mountedNode = babelParser.parseExpression(mountedCode).properties[0];
            node.declaration.properties.unshift(mountedNode);
          }
        }
      });
    }

    const { code: modifiedScript } = babelGenerator(ast, {
      comments: true,
      retainLines: true,
      compact: false,
    });
    let modifiedSource = source.replace(script, modifiedScript);
    if (isInPages) {
      modifiedSource = modifiedSource.replace(/(<[a-zA-Z]+[^>]*ref="[\w]+"[^>]*)(>)/g, (match, p1, p2) => {
        if (p1.includes("asyncLoadProp")) {
          return match;
        }
        return p1 + ` :asyncLoadProp="asyncLoad"${p2}`;
      });
    }

    // fs.appendFileSync("console.log", modifiedSource, "utf8");
    return modifiedSource;
  } catch (error) {
    console.log(this.resourcePath);
    console.log(error);
    return source;
  }
};
