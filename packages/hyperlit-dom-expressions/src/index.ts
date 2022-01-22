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
  spread(node: Element, accessor: any, isSVG?: Boolean, skipChildren?: Boolean): void;
  assign(node: Element, props: any, isSVG?: Boolean, skipChildren?: Boolean): void;
}

type Props = { [key: string]: any };
type Static = string | number | boolean | Date | RegExp;
type Dynamic = VirtualNode | Element;
type Child =  Static | Dynamic | (() => (Static | Element)) | (Static | Dynamic)[];
type VirtualNode = {
  type: string | (() => Child);
  attributes: Props;
  children: Child[];
  $h: boolean;
};
function isStatic(l: Child): l is Static {
  const type = typeof l;
  return "string" === type || "number" === type || "boolean" === type || l instanceof Date || l instanceof RegExp;
}
function staticAttr(l: any) {
  return typeof l !== "function" && typeof l !== "object"
}
function isStaticVirtualNode(l: any): l is VirtualNode {
  return typeof l.type === "string";
}
function isVirtualNode(l:any): l is VirtualNode {
  return l.$h;
}
function isPojo (obj: any): obj is Props {
  if (obj === null || typeof obj !== "object") {
    return false;
  }
  return Object.getPrototypeOf(obj) === Object.prototype;
}

export function h(type: string | (() => Child), props?: Props | Child, ...children: Child[]) {
  if (props === undefined) props = {};
  if (!isPojo(props) || isVirtualNode(props)) {
    children.unshift(props as Child);
    props = {};
  };
  return { type, children: children.flat(), attributes: props, $h: true };
}
function addChildren(y:VirtualNode){
  y.attributes.children = y.attributes.children || y.children;
  if (Array.isArray(y.attributes.children) && y.attributes.children.length == 1)
  y.attributes.children = y.attributes.children[0];
}
type StaticReturn = Element | Text | undefined;
export function createVDomEvaluator(r: Runtime) {
  let gid = 0;
  let uuid = 1;
  let cache: (StaticReturn | (StaticReturn)[])[] = [];

  function renderVDomTreeStatic(x: Exclude<Child, (Static | Dynamic)[]>, level?: Element): StaticReturn;
  function renderVDomTreeStatic(x: (Static | Dynamic)[], level?: Element): StaticReturn[];
  function renderVDomTreeStatic(x: Child, level?: Element): StaticReturn | StaticReturn[] {
    if (isStatic(x)) {
      let node = document.createTextNode(x.toString());
      if (level) level.appendChild(node);
      return node;
    } else if (isStaticVirtualNode(x)) {
      let e = document.createElement(x.type as string);
      let attrclone: Props = {};
      for (const attr in x.attributes) {
        let val = x.attributes[attr];
        if (staticAttr(val)) attrclone[attr] = val;
      }
      r.assign(e, attrclone, e instanceof SVGElement, true);
      for (const y of x.children) {
        renderVDomTreeStatic(y as VirtualNode, e);
      }
      if (level) level.appendChild(e);
      return e;
    } else if (Array.isArray(x)) {
      return x.map(y => renderVDomTreeStatic(y)) as (HTMLElement | undefined)[];
    }
  }
  
  function reactifyChildren(x: Static | Dynamic | (() => Static | Element), e?: Node) {
    if (isStatic(x)) return e;
    if (x instanceof Element) return x;
    if (typeof x === "function") return r.createComponent(x, undefined);
    if (typeof x.type === "function") {
      addChildren(x);
      return r.createComponent(x.type, x.attributes);
    }
    let attrclone: Props = {};
    let exists = false,
      dynamic = false;
    for (const attr in x.attributes) {
      let val = x.attributes[attr];
      if (!staticAttr(val)) {
        attrclone[attr] = val;
        exists = true;
      }
      if (typeof val === "function" && attr !== "ref" && attr.slice(0, 2) !== "on" && attr !== "children") {
        r.dynamicProperty(attrclone, attr);
        dynamic = true;
      }
    }
    if (exists)
      dynamic
        ? r.spread(e as Element, attrclone, e instanceof SVGElement, !!x.children.length)
        : r.assign(e as Element, attrclone, e instanceof SVGElement, !!x.children.length);
    let walk = e?.firstChild;
    let multiExpression = x.children.length <= 1 ? undefined : null;
    for (const y of x.children) {
      if (!isStatic(y)) {
        if (isVirtualNode(y)) {
          if (typeof y.type === "string") {
            reactifyChildren(y, walk!);
            walk = (walk && walk.nextSibling);
          } else {
            addChildren(y);
            for (const k in y.attributes) {
              if (typeof y.attributes[k] === "function" && !y.attributes[k].length && k !== "children")
                r.dynamicProperty(y.attributes, k);
            }
            r.insert(e!, r.createComponent(y.type, y.attributes), walk || multiExpression);
          }
        } else {
          r.insert(e!, y, walk || multiExpression);
        }
      }
    }
    return e;
  }

  
  function parseNode(node: Child, options: any) {
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
    }
  }
  function $(component: (props: Props) => Child): (props: Props) => Element | Element[] {
    let id = gid++,
      called = false;
    return (props: Props) => {
      let vdomTree = component(props);
      if (!called) {
        cache[id] = renderVDomTreeStatic(vdomTree as any);
        called = true;
      }
      let cached = cache[id];
      if (Array.isArray(vdomTree)) {
        let vt = vdomTree;
        return (cached as StaticReturn[]).map((x, i) => {
          let cloned = x?.cloneNode(true);
          return reactifyChildren(vt[i], cloned);
        });
      }
      let cloned = (cached as Element | undefined)?.cloneNode(true);
      return reactifyChildren(vdomTree, cloned);
    };
  }

  function once(component: Exclude<Child, (Static | Dynamic)[]>): Element;
  function once(component: (Static | Dynamic)[]): Element[];
  function once(component: Child): Element | Element[] {
    if (Array.isArray(component)) {
      return renderVDomTreeStatic(component)
        .map((y, i) => reactifyChildren(component[i], y));
    }
    let x = renderVDomTreeStatic(component);
    return reactifyChildren(component, x);
  }

  return [$, once] as [typeof $, typeof once];
}
