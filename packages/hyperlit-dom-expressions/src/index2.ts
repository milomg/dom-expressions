export interface IDom {
  type: string;
  content?: string;
  name: string;
  attrs: { [key: string]: any };
  children: IDom[];
}

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
declare type AttributeInfo = {
  [key: string]: {
    type: string;
    alias?: string;
  };
};
interface Runtime {
  effect<T>(fn: (prev?: T) => T, init?: T): any;
  insert(parent: MountableElement, accessor: any, marker?: Node | null, init?: any): any;
  createComponent(Comp: (props: any) => any, props: any): any;
  delegateEvents(eventNames: string[]): void;
  classList(node: Element, value: { [k: string]: boolean }, prev?: { [k: string]: boolean }): void;
  style(node: Element, value: { [k: string]: string }, prev?: { [k: string]: string }): void;
  dynamicProperty(props: any, key: string): any;
  setAttribute(node: Element, name: string, value: any): void;
  setAttributeNS(node: Element, namespace: string, name: string, value: any): void;
  Attributes: AttributeInfo;
  SVGAttributes: AttributeInfo;
  NonComposedEvents: Set<string>;
  SVGElements: Set<string>;
  SVGNamespace: Record<string, string>;
}
type TemplateCreate = (tmpl: HTMLTemplateElement[], data: any[], r: Runtime) => Node;
type CreateableTemplate = HTMLTemplateElement & { create: TemplateCreate };

export type HTMLTag = {
  (statics: TemplateStringsArray, ...args: unknown[]): Node | Node[];
};

const cache = new Map<TemplateStringsArray, HTMLTemplateElement[]>();

type Props = { [key: string]: any };
type Static = string | number | boolean | Date | RegExp;
type Dynamic = IDom | Element;
type Child = Static | Dynamic | (() => Static | Element) | (Static | Dynamic)[];
function isVirtualNode(l: any): l is IDom {
  return l.type && l.name && l.attrs && l.children;
}
function isPojo(obj: any): obj is Props {
  if (obj === null || typeof obj !== "object") {
    return false;
  }
  return Object.getPrototypeOf(obj) === Object.prototype;
}

// Some thoughts: we want to do as little as possible to keep track of what the user gave us, and do parsing only once. 
// The two ways of doing that (that I've thought of) are wrapping the final result in a closure and 
// just turning the h call into arrays

function h(): any {
  return arguments;
}
export function createHTML(r: Runtime, { delegateEvents = true } = {}): HTMLTag {
  let uuid = 1;
  (r as any).delegate = (el: Node, ev: string, expr: any) => {
    if (Array.isArray(expr)) {
      (el as any)[`__${ev}`] = expr[0];
      (el as any)[`__${ev}Data`] = expr[1];
    } else (el as any)[`__${ev}`] = expr;
  };
  (r as any).wrapProps = (props: any) => {
    for (const k in props) {
      if (typeof props[k] === "function" && !props[k].length) r.dynamicProperty(props, k);
    }
    return props;
  };

  function createTemplate(statics: TemplateStringsArray) {
    let i = 0,
      markup = "";
    for (; i < statics.length - 1; i++) {
      markup = markup + statics[i] + "<!--#-->";
    }
    markup = markup + statics[i];
    markup = markup
      .replace(/<(<!--#-->)/g, "<###")
      .replace(/>\n+\s*/g, ">")
      .replace(/\n+\s*</g, "<")
      .replace(/\s+</g, " <")
      .replace(/>\s+/g, "> ");

    const [html, code] = parseTemplate(parse(markup)),
      templates: HTMLTemplateElement[] = [];

    for (let i = 0; i < html.length; i++) {
      templates.push(document.createElement("template"));
      templates[i].innerHTML = html[i];
    }
    (templates[0] as CreateableTemplate).create = code;
    cache.set(statics, templates);
    return templates;
  }

  function parseKeyValue(tag: string, name: string, isSVG: boolean, options: any) {
    let count = options.counter++,
      info,
      expr = `!doNotWrap ? exprs[${count}]() : exprs[${count}]`;
    if (name === "style") {
      options.exprs.push(`r.style(${tag}, ${expr})`);
    } else if (name === "classList") {
      options.exprs.push(`r.classList(${tag}, ${expr})`);
    } else if (name === "on") {
      const id = uuid++;
      options.exprs.push(
        `const v${id} = ${expr}`,
        `for (const e in v${id}) ${tag}.addEventListener(e, v${id}[e])`
      );
    } else if (name === "onCapture") {
      const id = uuid++;
      options.exprs.push(
        `const v${id} = ${expr}`,
        `for (const e in v${id}) ${tag}.addEventListener(e, v${id}[e], true)`
      );
    } else if (!isSVG && (info = r.Attributes[name])) {
      if (info.type === "attribute") {
        options.exprs.push(`r.setAttribute(${tag},"${name}",${expr})`);
      } else options.exprs.push(`${tag}.${info.alias} = ${expr}`);
    } else if (isSVG || name.indexOf("-") > -1 || name.indexOf(":") > -1) {
      const ns = name.indexOf(":") > -1 && r.SVGNamespace[name.split(":")[0]];
      if (ns) options.exprs.push(`r.setAttributeNS(${tag},"${ns}","${name}",${expr})`);
      else if ((info = r.SVGAttributes[name])) {
        if (info.alias) options.exprs.push(`r.setAttribute(${tag},"${info.alias}",${expr})`);
        else options.exprs.push(`r.setAttribute(${tag},"${name}",${expr})`);
      } else
        options.exprs.push(
          `r.setAttribute(${tag},"${name.replace(
            /([A-Z])/g,
            g => `-${g[0].toLowerCase()}`
          )}",${expr})`
        );
    } else options.exprs.push(`${tag}.${name} = ${expr}`);
  }

  function parseAttribute(tag: string, name: string, isSVG: boolean, options: any) {
    if (name.slice(0, 2) === "on" && name !== "on" && name !== "onCapture") {
      const lc = name.toLowerCase();
      if (delegateEvents && !r.NonComposedEvents.has(lc.slice(2))) {
        const e = lc.slice(2);
        options.delegatedEvents.add(e);
        options.exprs.push(`r.delegate(${tag},"${e}",exprs[${options.counter++}])`);
      } else options.exprs.push(`${tag}.${lc} = exprs[${options.counter++}]`);
    } else if (name === "ref") {
      options.exprs.push(`exprs[${options.counter++}](${tag})`);
    } else {
      const childOptions = Object.assign({}, options, { exprs: [] }),
        count = options.counter;
      parseKeyValue(tag, name, isSVG, childOptions);
      options.decl.push(`_fn${count} = doNotWrap => {\n${childOptions.exprs.join(";\n")};\n}`);
      options.exprs.push(
        `typeof exprs[${count}] === "function" ? r.effect(_fn${count}) : _fn${count}(true)`
      );
      options.counter = childOptions.counter;
      options.wrap = false;
    }
  }

  function processChildren(node: IDom, options: any) {
    const childOptions = Object.assign({}, options, {
      first: true,
      multi: false,
      parent: options.path
    });
    if (node.children.length > 1) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (
          (child.type === "comment" && child.content === "#") ||
          (child.type === "tag" && child.name === "###")
        ) {
          childOptions.multi = true;
          break;
        }
      }
    }
    let i = 0;
    while (i < node.children.length) {
      const child = node.children[i];
      if (child.name === "###") {
        if (childOptions.multi) {
          node.children[i] = { type: "comment", content: "#" } as IDom;
          i++;
        } else node.children.splice(i, 1);
        processComponent(child, childOptions);
        continue;
      }
      parseNode(child, childOptions);
      i++;
    }
    options.counter = childOptions.counter;
    options.templateId = childOptions.templateId;
  }

  function processComponent(node: IDom, options: any) {
    const keys = Object.keys(node.attrs),
      props = [],
      componentIdentifier = options.counter++;

    for (let i = 0; i < keys.length; i++) {
      const name = keys[i],
        value = node.attrs[name];

      if (value === "###") {
        let count = options.counter++;
        props.push(`${name}: exprs[${count}]`);
      } else props.push(`${name}: "${value}"`);
    }
    if (
      node.children.length === 1 &&
      node.children[0].type === "comment" &&
      node.children[0].content === "#"
    ) {
      props.push(`children: () => exprs[${options.counter++}]`);
    } else if (node.children.length) {
      const children = { type: "fragment", children: node.children } as IDom,
        childOptions = Object.assign({}, options, {
          first: true,
          decl: [],
          exprs: []
        });
      parseNode(children, childOptions);
      props.push(`children: () => { ${childOptions.exprs.join(";\n")}}`);
      options.templateId = childOptions.templateId;
      options.counter = childOptions.counter;
    }
    let tag;
    if (options.multi) {
      tag = `_$el${uuid++}`;
      options.decl.push(`${tag} = ${options.path}.${options.first ? "firstChild" : "nextSibling"}`);
    }

    if (options.parent)
      options.exprs.push(
        `r.insert(${
          options.parent
        }, r.createComponent(exprs[${componentIdentifier}], r.wrapProps({${
          props.join(", ") || ""
        }}))${tag ? `, ${tag}` : ""})`
      );
    else
      options.exprs.push(
        `${
          options.fragment ? "" : "return "
        }r.createComponent(exprs[${componentIdentifier}], r.wrapProps({${props.join(", ") || ""}}))`
      );
    options.path = tag;
    options.first = false;
  }

  function parseNode(node: IDom, options: any) {
    if (node.type === "fragment") {
      const parts: string[] = [];
      node.children.forEach((child: IDom) => {
        if (child.type === "tag") {
          if (child.name === "###") {
            const childOptions = Object.assign({}, options, {
              first: true,
              fragment: true,
              decl: [],
              exprs: []
            });
            processComponent(child, childOptions);
            parts.push(childOptions.exprs[0]);
            options.counter = childOptions.counter;
            options.templateId = childOptions.templateId;
            return;
          }
          options.templateId++;
          const id = uuid;
          const childOptions = Object.assign({}, options, {
            first: true,
            decl: [],
            exprs: []
          });
          parseNode(child, childOptions);
          options.templateNodes.push([child]);
          parts.push(
            `function() { ${
              childOptions.decl.join(",\n") +
              ";\n" +
              childOptions.exprs.join(";\n") +
              `;\nreturn _$el${id};\n`
            }}()`
          );
          options.counter = childOptions.counter;
          options.templateId = childOptions.templateId;
        } else if (child.type === "text") {
          parts.push(`"${child.content!}"`);
        } else if (child.type === "comment" && child.content === "#") {
          parts.push(`exprs[${options.counter++}]`);
        }
      });
      options.exprs.push(`return [${parts.join(", \n")}]`);
    } else if (node.type === "tag") {
      const tag = `_$el${uuid++}`;
      options.decl.push(
        !options.decl.length
          ? `const ${tag} = tmpls[${options.templateId}].content.firstChild.cloneNode(true)`
          : `${tag} = ${options.path}.${options.first ? "firstChild" : "nextSibling"}`
      );
      const keys = Object.keys(node.attrs);
      const isSVG = r.SVGElements.has(node.name);
      for (let i = 0; i < keys.length; i++) {
        const name = keys[i],
          value = node.attrs[name];
        if (value === "###") {
          delete node.attrs[name];
          parseAttribute(tag, name, isSVG, options);
        }
      }
      options.path = tag;
      options.first = false;
      processChildren(node, options);
    } else if (node.type === "text") {
      const tag = `_$el${uuid++}`;
      options.decl.push(`${tag} = ${options.path}.${options.first ? "firstChild" : "nextSibling"}`);
      options.path = tag;
      options.first = false;
    } else if (node.type === "comment" && node.content === "#") {
      const tag = `_$el${uuid++}`;
      options.decl.push(`${tag} = ${options.path}.${options.first ? "firstChild" : "nextSibling"}`);
      if (options.multi) {
        options.exprs.push(`r.insert(${options.parent}, exprs[${options.counter++}], ${tag})`);
      } else options.exprs.push(`r.insert(${options.parent}, exprs[${options.counter++}])`);
      options.path = tag;
      options.first = false;
    }
  }

  function parseTemplate(nodes: IDom[]): [string[], TemplateCreate] {
    const options = {
        path: "",
        decl: [],
        exprs: [],
        delegatedEvents: new Set(),
        counter: 0,
        first: true,
        multi: false,
        templateId: 0,
        templateNodes: []
      },
      id = uuid,
      origNodes = nodes;
    let toplevel;
    if (nodes.length > 1) {
      nodes = [{ type: "fragment", children: nodes } as IDom];
    }

    if (nodes[0].name === "###") {
      toplevel = true;
      processComponent(nodes[0], options);
    } else parseNode(nodes[0], options);
    r.delegateEvents(Array.from(options.delegatedEvents) as string[]);
    const templateNodes = [origNodes].concat(options.templateNodes);
    return [
      templateNodes.map(t => stringify(t)),
      new Function(
        "tmpls",
        "exprs",
        "r",
        options.decl.join(",\n") +
          ";\n" +
          options.exprs.join(";\n") +
          (toplevel ? "" : `;\nreturn _$el${id};\n`)
      ) as TemplateCreate
    ];
  }

  function html(statics: TemplateStringsArray, ...args: unknown[]): Node {
    const templates = cache.get(statics) || createTemplate(statics);
    return (templates[0] as CreateableTemplate).create(templates, args, r);
  }

  return html;
}
