import {ensureFileExist, ensurePathExist} from "../utils/index.mjs";
import {join, resolve} from "node:path";
import {readFile, writeFile} from "node:fs/promises";
import os from "os";
import {getFileName} from "./index.mjs";

export async function loadEnvFile() {
    try {
        const filePath = resolve(join('./.env'));
        await ensureFileExist(filePath)
        const data = await readFile(filePath, 'utf-8');
        const lines = data.split('\n');
        lines.forEach(line => {
            if (!line.startsWith('#') && line.trim() !== '') {
                const [key, value] = line.split('=');
                process.env[key.trim()] = value.trim().replace(/^['"]|['"]$/g, '');
            }
        });
    } catch (err) {
        // console.error(`Error loading .env file: ${err.message}`);
    }
}


export function absolutePathParse(path) {
    const isWin = os.platform() === 'win32';
    if (isWin) {
        return `file:///${path}`; //.replace(/^C:/ig, 'file://');
    }
    return path;
}

/**
 *
 * @param pages {{name: string, module: string}[]}
 * @param initialId {string}
 * @return {Promise<*>}
 */
export async function ensureAppRouteFileExist({pages, initialId}) {
    const rawInitialPage = pages
        .filter(x => x?.id === initialId)
        .shift();
    const initialPage = (rawInitialPage?.name ?? 'home').replace('_page', '').trim();
    const componentFilePath = resolve(join('src', 'AppRoute.jsx'));
    const stateFilePath = resolve(join('src', 'routing.mjs'));
    const guardFilePath = resolve(join('src', 'routing_guard.mjs'));
    await ensureFileExist(componentFilePath);
    await ensureFileExist(stateFilePath);
    await ensureFileExist(guardFilePath);
    const importTrans = page => `import {${getFileName(page.name)}} from './modules/${page.module.replace(/^\/+/g, '')}/${page.name}';`;
    const guardFileContents = await import(absolutePathParse(guardFilePath));
    const shouldWriteGuardFs = typeof guardFileContents?.beforeNavigate !== "function";
    if (shouldWriteGuardFs) {
        await writeFile(guardFilePath, `
/**
 * 
 * @param prev {string}
 * @param next {string}
 * @param callback {(next:string)=>*}
 */
export function beforeNavigate({prev,next},callback){
    callback(next);
}`);
    }

    await writeFile(stateFilePath, `
import {BehaviorSubject} from "rxjs";
import {beforeNavigate} from './routing_guard.mjs';

const currentRoute = new BehaviorSubject('');

/**
 *
 * @param route {string|{name: string, type: string, module: string}}
 * @param pushToState{boolean}
 */
export function setCurrentRoute(route,pushToState=true) {
    beforeNavigate({prev:currentRoute.value,next:route?.name??route},(nextRoute)=>{
        nextRoute = nextRoute?.trim()?.replace(/^\\//ig,'')??'';
        currentRoute.next(nextRoute);
       if(pushToState){
           window.history.pushState({}, '', \`/\${nextRoute}\`);
       }
    });
}

/**
 *
 * @param fn {function}
 */
export function listeningForRouteChange(fn) {
    return currentRoute.subscribe(fn);
}

export function getCurrentRouteValue() {
    return currentRoute.value;
}
if (typeof window !== 'undefined') {
    window.onpopstate = function (_) {
        const path = window.location.pathname.replace(/^\\//ig,'');
        beforeNavigate({prev:currentRoute.value,next:path},(nextRoute)=>{
            currentRoute.next(nextRoute);
        });
    } 
}`);
    await writeFile(componentFilePath, `import {useState,useEffect} from 'react';
import {listeningForRouteChange,setCurrentRoute} from './routing.mjs';
${pages.map(importTrans).join('\n')}

function getRoute(current) {
    switch (current) {
        ${pages.map(page => {
        return `
        case '${page?.name?.replaceAll('_page', '')}':
            return <${getFileName(page.name)}/>`
    }).join('\n')}
        default:
            return <></>
    }
}

function handlePathToRouteName(pathname){
    pathname = pathname?.startsWith('/')?pathname:\`/\${pathname}\`;
    switch (pathname) {
        ${pages.map(page => {
        return `
        case '/${page?.name?.replaceAll('_page', '')}':
            return '${page?.name?.replaceAll('_page', '')}';`
    }).join('\n')}
        default:
            return '${initialPage}';
    }
}

export function AppRoute(){
    const [current,setCurrent] = useState('');
    
    useEffect(() => {
        const subs = listeningForRouteChange(value => {
            setCurrent(handlePathToRouteName(value));
        });
        return () => subs.unsubscribe();
    }, []);

    useEffect(() => {
        setCurrentRoute(handlePathToRouteName(window.location.pathname),false)
    }, []);
    
    return getRoute(current);
}
    `);
}

export async function ensureSchemaFileExist() {
    const filePath = resolve(join('fastui.schema.json'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Component",
  "description": "FastUI component details",
  "type": "object",
  "properties": {
    "component": {
      "$ref": "#/$defs/component"
    },
    "components": {
      "$ref": "#/$defs/component"
    },
    "loop": {
      "type": "object",
      "properties": {
        "modifier": {
          "type": "object",
          "properties": {
            "extend": {
              "$ref": "#/$defs/local_path"
            },
            "feed": {
              "$ref": "#/$defs/local_path"
            },
            "props": {
              "type": "object",
              "properties": {
                "children": {
                  "type": "string"
                }
              }
            },
            "styles": {
              "oneOf": [
                {
                  "type": "string",
                  "pattern": "^(logics\\\\.)[a-zA-Z0-9]+"
                },
                {
                  "$ref": "#/$defs/css"
                }
              ]
            },
            "frame": {
              "$ref": "#/$defs/frame"
            }
          },
          "required": ["feed"]
        }
      }
    },
    "condition": {
      "type": "object",
      "properties": {
        "modifier": {
          "type": "object",
          "properties": {
            "extend": {
              "$ref": "#/$defs/local_path"
            },
            "left": {
              "$ref": "#/$defs/local_path"
            },
            "right": {
              "$ref": "#/$defs/local_path"
            },
            "frame": {
              "$ref": "#/$defs/frame"
            }
          }
        }
      },
      "required": [
        "modifier"
      ]
    }
  },
  "$defs": {
    "frame": {
      "oneOf": [
        {
          "type": "string",
          "enum": [
            "column.start",
            "column.end",
            "row.start",
            "row.end",
            "column.start.stack",
            "column.end.stack",
            "row.start.stack",
            "row.end.stack"
          ]
        },
        {
          "type": "object",
          "properties": {
            "base": {
              "type": "string",
              "enum": [
                "column.start",
                "column.end",
                "row.start",
                "row.end",
                "column.start.stack",
                "column.end.stack",
                "row.start.stack",
                "row.end.stack"
              ]
            },
            "styles": {
              "oneOf": [
                {
                  "type": "string",
                  "pattern": "^(logics\\\\.)[a-zA-Z0-9]+"
                },
                {
                  "$ref": "#/$defs/css"
                }
              ]
            }
          },
          "required": [
            "base"
          ]
        }
      ]
    },
    "local_path": {
      "type": "string",
      "pattern": "((\\\\.yml)|(\\\\.yaml))$"
    },
    "component": {
      "type": "object",
      "properties": {
        "base": {
          "type": "string",
          "enum": [
            "rectangle",
            "image",
            "input",
            "text"
          ]
        },
        "modifier": {
          "type": "object",
          "properties": {
            "extend": {
              "$ref": "#/$defs/local_path"
            },
            "props": {
              "type": "object",
              "properties": {
                "children": {
                  "type": "string"
                }
              }
            },
            "states": {
              "type": "object",
              "patternProperties": {
              }
            },
            "effects": {
              "type": "object"
            },
            "styles": {
              "oneOf": [
                {
                  "type": "string",
                  "pattern": "^(logics\\\\.)[a-zA-Z0-9]+"
                },
                {
                  "$ref": "#/$defs/css"
                }
              ]
            },
            "frame": {
              "$ref": "#/$defs/frame"
            }
          }
        }
      },
      "required": [
        "modifier"
      ]
    },
    "length": {
      "anyOf": [
        {
          "type": "double",
          "required": true
        },
        {
          "type": "string",
          "required": true
        }
      ]
    },
    "time": {
      "$ref": "#/$defs/length"
    },
    "translationValue": {
      "$ref": "#/$defs/length"
    },
    "btrr": {
      "oneOf": [
        {
          "title": "radius",
          "$ref": "#/$defs/length"
        },
        {
          "type": "string",
          "enum": [
            "0"
          ],
          "required": true
        }
      ]
    },
    "border": {
      "type": "string",
      "enum": [
        "none",
        "solid",
        "ridge",
        "outset",
        "inset",
        "hidden",
        "groove",
        "double",
        "dotted",
        "dashed"
      ],
      "default": "none"
    },
    "borderWidth": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "medium",
            "thin",
            "thick"
          ],
          "required": true
        },
        {
          "type": "double",
          "required": true
        }
      ]
    },
    "css": {
      "type": "object",
      "properties": {
        "animationIterationCount": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "1",
                "infinite"
              ],
              "required": true
            },
            {
              "type": "number"
            }
          ]
        },
        "animationName": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "type": "string",
              "title": "custom identifier"
            }
          ]
        },
        "animationTimingFunction": {
          "oneOf": [
            {
              "type": "string",
              "title": "animation-timing-function",
              "enum": [
                "ease",
                "step-start",
                "step-end",
                "linear",
                "ease-out",
                "ease-in-out",
                "ease-in"
              ],
              "required": true
            },
            {
              "type": "object",
              "title": "cubic-bezier",
              "properties": {
                "number1": {
                  "type": "string"
                },
                "number2": {
                  "type": "string"
                },
                "number3": {
                  "type": "string"
                },
                "number4": {
                  "type": "string"
                }
              }
            },
            {
              "type": "string",
              "title": "steps",
              "enum": [
                "start",
                "end"
              ],
              "required": true
            }
          ]
        },
        "integer": {
          "type": "integer"
        },
        "borderRadius": {
          "$ref": "#/$defs/length"
        },
        "borderStyle": {
          "$ref": "#/$defs/border"
        },
        "borderTopStyle": {
          "$ref": "#/$defs/border"
        },
        "borderRightStyle": {
          "$ref": "#/$defs/border"
        },
        "borderBottomStyle": {
          "$ref": "#/$defs/border"
        },
        "borderLeftStyle": {
          "$ref": "#/$defs/border"
        },
        "borderWidth": {
          "$ref": "#/$defs/borderWidth"
        },
        "borderTopWidth": {
          "$ref": "#/$defs/borderWidth"
        },
        "borderRightWidth": {
          "$ref": "#/$defs/borderWidth"
        },
        "borderBottomWidth": {
          "$ref": "#/$defs/borderWidth"
        },
        "borderLeftWidth": {
          "$ref": "#/$defs/borderWidth"
        },
        "color": {
          "type": "string",
          "format": "color"
        },
        "backgroundImage": {},
        "backgroundSize": {
          "oneOf": [
            {
              "type": "string",
              "title": "background-size",
              "enum": [
                "auto",
                "cover",
                "contain"
              ],
              "required": true
            }
          ]
        },
        "backgroundPosition": {},
        "borderColor": {
          "type": "string",
          "format": "color"
        },
        "top": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "borderTopColor": {
          "oneOf": [
            {
              "type": "string",
              "format": "color"
            },
            {
              "type": "string",
              "enum": [
                "transparent"
              ],
              "required": true
            }
          ]
        },
        "right": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "borderRightColor": {
          "oneOf": [
            {
              "type": "string",
              "format": "color"
            },
            {
              "type": "string",
              "enum": [
                "transparent"
              ],
              "required": true
            }
          ]
        },
        "bottom": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "borderBottomColor": {
          "oneOf": [
            {
              "type": "string",
              "format": "color"
            },
            {
              "type": "string",
              "enum": [
                "transparent"
              ],
              "required": true
            }
          ]
        },
        "left": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "borderLeftColor": {
          "oneOf": [
            {
              "type": "string",
              "format": "color"
            },
            {
              "type": "string",
              "enum": [
                "transparent"
              ],
              "required": true
            }
          ]
        },
        "borderTopLeftRadius": {
          "$ref": "#/$defs/btrr"
        },
        "borderTopRightRadius": {
          "$ref": "#/$defs/btrr"
        },
        "borderBottomLeftRadius": {
          "$ref": "#/$defs/btrr"
        },
        "borderBottomRightRadius": {
          "$ref": "#/$defs/btrr"
        },
        "borderImageSource": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "title": "url",
              "type": "string"
            }
          ]
        },
        "borderImageSlice": {
          "type": "object",
          "properties": {
            "value": {
              "type": "integer",
              "default": "100"
            },
            "unit": {
              "type": "string",
              "enum": [
                "%"
              ],
              "required": true
            }
          }
        },
        "width": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "borderImageWidth": {
          "type": "integer"
        },
        "borderImageOutset": {
          "type": "integer"
        },
        "borderSpacing": {
          "type": "array",
          "format": "table",
          "title": "border-spacing",
          "uniqueItems": true,
          "items": {
            "type": "object",
            "title": "border-spacing",
            "properties": {
              "first": {
                "$ref": "#/$defs/length"
              },
              "second": {
                "$ref": "#/$defs/length"
              }
            }
          }
        },
        "clip": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            },
            {
              "type": "array",
              "format": "table",
              "title": "rect",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "rect",
                "properties": {
                  "length1": {
                    "$ref": "#/$defs/length"
                  },
                  "length2": {
                    "$ref": "#/$defs/length"
                  },
                  "length3": {
                    "$ref": "#/$defs/length"
                  },
                  "length4": {
                    "$ref": "#/$defs/length"
                  }
                }
              }
            },
            {
              "type": "array",
              "format": "table",
              "title": "inset",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "inset",
                "properties": {
                  "length1": {
                    "$ref": "#/$defs/length"
                  },
                  "length2": {
                    "$ref": "#/$defs/length"
                  },
                  "length3": {
                    "$ref": "#/$defs/length"
                  },
                  "length4": {
                    "$ref": "#/$defs/length"
                  }
                }
              }
            }
          ]
        },
        "columnWidth": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "columnC ount": {
          "oneOf": [
            {
              "type": "integer"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "columnGap": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "normal"
              ],
              "required": true
            }
          ]
        },
        "columnRuleColor": {
          "type": "string",
          "format": "color"
        },
        "columnRuleWidth": {
          "oneOf": [
            {
              "title": "crw",
              "type": "string",
              "enum": [
                "medium",
                "thin",
                "thick"
              ],
              "required": true
            },
            {
              "title": "length",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "content": {
          "oneOf": [
            {
              "title": "content",
              "type": "string",
              "enum": [
                "normal",
                "open-quote",
                "none",
                "no-open-quote",
                "no-close-quote",
                "icon",
                "close-quote"
              ],
              "required": true
            },
            {
              "title": " identifier",
              "type": "string"
            },
            {
              "title": " url",
              "type": "string"
            },
            {
              "title": " counter",
              "type": "string"
            }
          ]
        },
        "counterIncrement": {
          "oneOf": [
            {
              "title": "counter-increment",
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "title": " identifier",
              "type": "string"
            },
            {
              "title": " integer",
              "type": "integer"
            }
          ]
        },
        "counterReset": {
          "oneOf": [
            {
              "title": "counter-increment",
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "title": " identifier",
              "type": "string"
            },
            {
              "title": " integer",
              "type": "integer"
            }
          ]
        },
        "cursor": {
          "oneOf": [
            {
              "title": "cursor",
              "type": "string",
              "enum": [
                "auto",
                "zoom-out",
                "zoom-in",
                "wait",
                "w-resize",
                "vertical-text",
                "text",
                "sw-resize",
                "se-resize",
                "s-resize",
                "row-resize",
                "progress",
                "pointer",
                "nwse-resize",
                "nw-resize",
                "ns-resize",
                "not-allowed",
                "none",
                "no-drop",
                "nesw-resize",
                "ne-resize",
                "n-resize",
                "move",
                "help",
                "ew-resize",
                "e-resize",
                "default",
                "crosshair",
                "copy",
                "context-menu",
                "col-resize",
                "cell",
                "all-scroll",
                "alias"
              ],
              "required": true
            },
            {
              "title": "url",
              "type": "string"
            }
          ]
        },
        "flexGrow": {
          "type": "integer"
        },
        "flexShrink": {
          "type": "integer",
          "default": "1"
        },
        "flexBasis": {
          "oneOf": [
            {
              "$ref": "#/$defs/length"
            },
            {
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            }
          ]
        },
        "fontFamily": {
          "type": "string"
        },
        "fontSize": {
          "oneOf": [
            {
              "title": "font-size",
              "type": "string",
              "enum": [
                "medium",
                "xx-small",
                "xx-large",
                "x-small",
                "x-large",
                "smaller",
                "small",
                "larger",
                "large"
              ],
              "required": true
            },
            {
              "title": "size",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "fontSizeAdjust": {
          "type": "string",
          "default": "none"
        },
        "height": {},
        "icon": {
          "type": "string",
          "default": "auto"
        },
        "overflowWrap": {
          "type": "string"
        },
        "imageOrientation": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "value": {
                  "type": "integer",
                  "default": "1"
                },
                "unit": {
                  "type": "string",
                  "enum": [
                    "deg",
                    "grad",
                    "rad",
                    "turn"
                  ],
                  "required": true
                }
              }
            }
          ]
        },
        "letterSpacing": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "normal"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "lineHeight": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "normal"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "listStyleImage": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "title": "url",
              "type": "string"
            }
          ]
        },
        "maxHeight": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "maxWidth": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "minHeight": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "0",
                "auto"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "minWidth": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "0",
                "auto"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "objectPosition": {
          "oneOf": [
            {
              "type": "array",
              "format": "table",
              "title": "object-position",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "object-position",
                "properties": {
                  "first": {
                    "type": "string",
                    "enum": [
                      "50%",
                      "right ",
                      "left ",
                      "center "
                    ],
                    "required": true
                  },
                  "second": {
                    "type": "string",
                    "enum": [
                      "50%",
                      "bottom",
                      "top",
                      "center "
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "opacity": {
          "type": "integer",
          "default": "1"
        },
        "orphans": {
          "type": "integer",
          "default": "2"
        },
        "outlineColor": {
          "oneOf": [
            {
              "title": "invert",
              "type": "string",
              "enum": [
                "invert"
              ],
              "required": true
            },
            {
              "type": "string",
              "format": "color"
            }
          ]
        },
        "outlineOffset": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "0"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "outlineWidth": {
          "oneOf": [
            {
              "title": "crw",
              "type": "string",
              "enum": [
                "medium",
                "thin",
                "thick"
              ],
              "required": true
            },
            {
              "title": "length",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "paddingTop": {
          "oneOf": [
            {
              "title": "padding-top",
              "type": "string",
              "enum": [
                "0"
              ],
              "required": true
            },
            {
              "title": "padding-top",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "paddingBottom": {
          "oneOf": [
            {
              "title": "padding-top",
              "type": "string",
              "enum": [
                "0"
              ],
              "required": true
            },
            {
              "title": "padding-top",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "paddingLeft": {
          "oneOf": [
            {
              "title": "padding-top",
              "type": "string",
              "enum": [
                "0"
              ],
              "required": true
            },
            {
              "title": "padding-top",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "paddingRight": {
          "oneOf": [
            {
              "title": "padding-top",
              "type": "string",
              "enum": [
                "0"
              ],
              "required": true
            },
            {
              "title": "padding-top",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "perspective": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "perspectiveOrigin": {
          "oneOf": [
            {
              "type": "array",
              "format": "table",
              "title": "perspective-origin",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "perspective-origin",
                "properties": {
                  "first": {
                    "type": "string",
                    "enum": [
                      "50%",
                      "top",
                      "right",
                      "left",
                      "center",
                      "bottom"
                    ],
                    "required": true
                  },
                  "second": {
                    "type": "string",
                    "enum": [
                      "50%"
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "quotes": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "type": "array",
              "format": "table",
              "title": "quotes",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "quotes",
                "properties": {
                  "first": {
                    "type": "string"
                  },
                  "second": {
                    "type": "string"
                  }
                }
              }
            }
          ]
        },
        "tabSize": {
          "oneOf": [
            {
              "title": "tab-size",
              "type": "integer"
            },
            {
              "$ref": "#/$defs/length"
            },
            {
              "title": "Integer",
              "type": "integer"
            }
          ]
        },
        "textAlign": {
          "oneOf": [
            {
              "title": "text-align",
              "type": "string",
              "enum": [
                "start",
                "right",
                "left",
                "match-parent",
                "justify",
                "end",
                "center"
              ],
              "required": true
            },
            {
              "title": "String",
              "type": "string"
            }
          ]
        },
        "textEmphasisStyle": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none",
                "triangle",
                "sesame",
                "open",
                "filled",
                "double-circle",
                "dot",
                "circle"
              ],
              "required": true
            },
            {
              "title": "String",
              "type": "string"
            }
          ]
        },
        "textEmphasisColor": {
          "type": "string",
          "format": "color"
        },
        "textIndent": {
          "oneOf": [
            {
              "title": "text-indent",
              "type": "string",
              "enum": [
                "0"
              ],
              "required": true
            },
            {
              "title": "percentage",
              "type": "string",
              "enum": [
                "%"
              ],
              "required": true
            },
            {
              "type": "array",
              "format": "table",
              "title": "hanging each-line",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "hanging each-line",
                "properties": {
                  "length": {
                    "$ref": "#/$defs/length"
                  },
                  "hanging": {
                    "type": "string",
                    "enum": [
                      "hanging"
                    ],
                    "required": true
                  },
                  "eachLine": {
                    "type": "string",
                    "enum": [
                      "each-line"
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "type": "array",
              "format": "table",
              "title": "hanging",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "hanging",
                "properties": {
                  "length": {
                    "$ref": "#/$defs/length"
                  },
                  "hanging": {
                    "type": "string",
                    "enum": [
                      "hanging"
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "type": "array",
              "format": "table",
              "title": "each-line",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "each-line",
                "properties": {
                  "length": {
                    "$ref": "#/$defs/length"
                  },
                  "eachLine": {
                    "type": "string",
                    "enum": [
                      "each-line"
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "title": "length",
              "$ref": "#/$defs/length"
            }
          ]
        },
        "textCombineHorizontal": {
          "oneOf": [
            {
              "title": "text-combine-horizontal",
              "type": "string",
              "enum": [
                "none",
                "all"
              ],
              "required": true
            },
            {
              "title": "digits",
              "type": "integer"
            }
          ]
        },
        "textOverflow": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "clip",
                "ellipsis"
              ],
              "required": true
            },
            {
              "title": "String",
              "type": "string"
            }
          ]
        },
        "transform": {
          "oneOf": [
            {
              "title": "String",
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "title": "translateZ",
              "$ref": "#/$defs/length"
            },
            {
              "title": "translateY",
              "$ref": "#/$defs/translationValue"
            },
            {
              "title": "translateX",
              "$ref": "#/$defs/translationValue"
            },
            {
              "type": "array",
              "format": "table",
              "title": "translate3d",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "translate3d",
                "properties": {
                  "translationValue1": {
                    "$ref": "#/$defs/translationValue"
                  },
                  "translationValue2": {
                    "$ref": "#/$defs/translationValue"
                  },
                  "length": {
                    "$ref": "#/$defs/length"
                  }
                }
              }
            },
            {
              "type": "array",
              "format": "table",
              "title": "translate",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "translate",
                "properties": {
                  "translationValue1": {
                    "$ref": "#/$defs/translationValue"
                  },
                  "translationValue2": {
                    "$ref": "#/$defs/translationValue"
                  }
                }
              }
            },
            {
              "title": "skewY",
              "type": "string",
              "enum": [
                "deg",
                "grad",
                "rad",
                "turn"
              ],
              "required": true
            },
            {
              "title": "skewX",
              "type": "string",
              "enum": [
                "deg",
                "grad",
                "rad",
                "turn"
              ],
              "required": true
            },
            {
              "title": "scaleZ",
              "type": "integer"
            },
            {
              "title": "scaleY",
              "type": "integer"
            },
            {
              "title": "scaleX",
              "type": "integer"
            },
            {
              "title": "rotateZ",
              "type": "string",
              "enum": [
                "deg",
                "grad",
                "rad",
                "turn"
              ],
              "required": true
            },
            {
              "title": "rotateY",
              "type": "string",
              "enum": [
                "deg",
                "grad",
                "rad",
                "turn"
              ],
              "required": true
            },
            {
              "title": "rotateX",
              "type": "string",
              "enum": [
                "deg",
                "grad",
                "rad",
                "turn"
              ],
              "required": true
            },
            {
              "title": "rotate",
              "type": "string",
              "enum": [
                "deg",
                "grad",
                "rad",
                "turn"
              ],
              "required": true
            },
            {
              "type": "array",
              "format": "table",
              "title": "rotate3d",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "rotate3d",
                "properties": {
                  "number1": {
                    "type": "integer"
                  },
                  "number2": {
                    "type": "integer"
                  },
                  "number3": {
                    "type": "integer"
                  },
                  "angle": {
                    "type": "string",
                    "enum": [
                      "deg",
                      "grad",
                      "rad",
                      "turn"
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "title": "perspective",
              "$ref": "#/$defs/length"
            },
            {
              "type": "array",
              "format": "table",
              "title": "matrix3d",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "matrix3d",
                "properties": {
                  "number1": {
                    "type": "integer"
                  },
                  "number2": {
                    "type": "integer"
                  },
                  "number3": {
                    "type": "integer"
                  },
                  "number4": {
                    "type": "integer"
                  },
                  "number5": {
                    "type": "integer"
                  },
                  "number6": {
                    "type": "integer"
                  },
                  "number7": {
                    "type": "integer"
                  },
                  "number8": {
                    "type": "integer"
                  },
                  "number9": {
                    "type": "integer"
                  },
                  "number10": {
                    "type": "integer"
                  },
                  "number11": {
                    "type": "integer"
                  },
                  "number12": {
                    "type": "integer"
                  },
                  "number13": {
                    "type": "integer"
                  },
                  "number14": {
                    "type": "integer"
                  },
                  "number15": {
                    "type": "integer"
                  },
                  "number16": {
                    "type": "integer"
                  }
                }
              }
            },
            {
              "type": "array",
              "format": "table",
              "title": "matrix",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "matrix",
                "properties": {
                  "number1": {
                    "type": "integer"
                  },
                  "number2": {
                    "type": "integer"
                  },
                  "number3": {
                    "type": "integer"
                  },
                  "number4": {
                    "type": "integer"
                  },
                  "number5": {
                    "type": "integer"
                  },
                  "number6": {
                    "type": "integer"
                  }
                }
              }
            }
          ]
        },
        "transformOrigin": {
          "oneOf": [
            {
              "type": "array",
              "format": "table",
              "title": "transform-origin",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "transform-origin",
                "properties": {
                  "first": {
                    "type": "string",
                    "enum": [
                      "50%",
                      "top",
                      "right",
                      "left",
                      "center",
                      "bottom"
                    ],
                    "required": true
                  },
                  "second": {
                    "type": "string",
                    "enum": [
                      "50%"
                    ],
                    "required": true
                  }
                }
              }
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "textShadow": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "none"
              ],
              "required": true
            },
            {
              "type": "array",
              "format": "table",
              "title": "text-shadow",
              "uniqueItems": true,
              "items": {
                "type": "object",
                "title": "text-shadow",
                "properties": {
                  "length1": {
                    "$ref": "#/$defs/length"
                  },
                  "length2": {
                    "$ref": "#/$defs/length"
                  },
                  "length3": {
                    "$ref": "#/$defs/length"
                  },
                  "length4": {
                    "title": "color",
                    "type": "string",
                    "format": "color"
                  }
                }
              }
            }
          ]
        },
        "transitionProperty": {
          "oneOf": [
            {
              "title": "text-combine-horizontal",
              "type": "string",
              "enum": [
                "none",
                "all"
              ],
              "required": true
            },
            {
              "title": "String",
              "type": "string"
            }
          ]
        },
        "transitionTimingFunction": {
          "oneOf": [
            {
              "type": "string",
              "title": "transition-timing-function",
              "enum": [
                "ease",
                "step-start",
                "step-end",
                "linear",
                "ease-out",
                "ease-in-out",
                "ease-in"
              ],
              "required": true
            },
            {
              "type": "object",
              "title": "cubic-bezier",
              "properties": {
                "number1": {
                  "type": "string"
                },
                "number2": {
                  "type": "string"
                },
                "number3": {
                  "type": "string"
                },
                "number4": {
                  "type": "string"
                }
              }
            },
            {
              "type": "string",
              "title": "steps",
              "enum": [
                "start",
                "end"
              ],
              "required": true
            }
          ]
        },
        "transitionDuration": {
          "$ref": "#/$defs/time"
        },
        "verticalAlign": {
          "oneOf": [
            {
              "type": "string",
              "enum": [
                "baseline",
                "top",
                "text-top",
                "text-bottom",
                "super",
                "sub",
                "middle",
                "bottom"
              ],
              "required": true
            },
            {
              "title": "Percentage",
              "type": "string",
              "enum": [
                "%"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            }
          ]
        },
        "widows": {
          "title": "integer",
          "type": "integer",
          "default": "2"
        },
        "wordSpacing": {
          "oneOf": [
            {
              "title": "word-spacing",
              "type": "string",
              "enum": [
                "normal"
              ],
              "required": true
            },
            {
              "$ref": "#/$defs/length"
            },
            {
              "title": "spacing",
              "type": "string",
              "enum": [
                "%"
              ],
              "required": true
            }
          ]
        },
        "zIndex": {
          "oneOf": [
            {
              "title": "z-index",
              "type": "string",
              "enum": [
                "auto"
              ],
              "required": true
            },
            {
              "title": "Integer",
              "type": "integer"
            }
          ]
        }
      }
    }
  }
}`);
}

export async function ensureWatchFileExist() {
    const filePath = resolve(join('watch.mjs'));
    await ensureFileExist(filePath);
    await writeFile(filePath, `import {watch} from 'node:fs'
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exec} from 'node:child_process';
import {writeFile} from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getContent(componentFile, componentName) {
    return \`
import {\${componentName}} from "\${componentFile}";

export function App() {
    return (
        <>
            <\${componentName}/>
        </>
    );
}

export default App;\`;
}

function firstUpperCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getFileName(path) {
    return path.split('/').pop().replace('.yml', '');
}

function snakeToCamel(str) {
    return \`\${str}\`
        .replace(/_([a-z])/ig, (_, letter) => letter.toUpperCase());
}

watch(join(__dirname, 'src', 'blueprints'), {recursive: true}, (event, filename) => {
    if (!\`\${filename}\`.endsWith('.yml') || \`\${filename}\`.endsWith('~')) {
        return;
    }
    const file = \`./src/blueprints/\${filename}\`;
    const componentFile = \`./\${filename}\`.replace('.yml', '.jsx');
    const componentName = firstUpperCase(snakeToCamel(getFileName(file)));

    // console.log(file, '------')
    exec(\`fastui specs build \${file}\`, {
        cwd: __dirname
    }, (error, stdout, stderr) => {
        //if (!error) {
          //  writeFile(\`./src/App.jsx\`, getContent(componentFile, componentName))
            //    .catch(console.log);
        //}
    });
});
`);
}

// export async function ensureConfigFileExist() {
//     const filePath = resolve(join('fastui.rc.mjs'));
//     await ensureFileExist(filePath);
//     await writeFile(filePath, `export const FIGMA_TOKEN="";
// export const FIGMA_FILE="";
// `);
// }

export async function ensureBlueprintFolderExist() {
    const filePath = resolve(join('src', 'blueprints'));
    await ensurePathExist(filePath);
}

export async function ensureStartScript() {
    const isWin = os.platform() === 'win32';
    const joiner = isWin ? '|' : '&';
    const filePath = resolve(join('package.json'));
    await ensureFileExist(filePath);
    const file = await readFile(filePath, {encoding: 'utf-8'});
    const fileMap = JSON.parse(`${file}`.trim().startsWith('{') ? file : '"{}"');
    const {scripts = {}} = fileMap;
    const {start = 'echo "no command"'} = scripts;
    const startParts = `${start}`.split(joiner);
    const lastScript = startParts.pop().trim();
    await writeFile(filePath, JSON.stringify({
        ...fileMap,
        scripts: {
            ...scripts,
            start: `node ./watch.mjs ${joiner} fastui specs build ./src/blueprints ${joiner} ${lastScript}`
        }
    }, null, 2));
}
