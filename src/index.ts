import type { DecorationOptions, DecorationRenderOptions, ExtensionContext, Position, TextDocument, TextEditorDecorationType } from 'vscode';
import { CompletionItem, CompletionItemKind, MarkdownString, OverviewRulerLane, Range, SnippetString, Uri, commands, languages, window, workspace } from 'vscode';
import { fetch } from 'ohmyfetch';
import openType from 'opentype.js';
import { decompress } from 'wawoff2';
import { disposeSettingListener, getSettings } from './settings';
import { Log } from './log';
import { getRelativePath } from './utils';
import { EXT_NAME, getCommandName } from './constant';

const state = {
  fontContext: undefined as openType.Font | undefined,
  iconNameUnicodeMap: new Map<string, string>(),
};

const fontSize = workspace.getConfiguration('editor').get('fontSize');
const decorationMap = new Map<string, TextEditorDecorationType>();
const decorationOptionsMap = new Map<string, DecorationRenderOptions>();

const getSvgFile = async (iconName: string, context: ExtensionContext) => {
  const svgPath = Uri.joinPath(context.globalStorageUri, EXT_NAME, `${iconName}.svg`);
  try {
    await workspace.fs.readFile(svgPath);

    return svgPath;
  } catch (error) {
    const fontContext = state?.fontContext;
    if (!fontContext) {
      return false;
    }

    const unicode = state.iconNameUnicodeMap.get(iconName);

    const glyphIndex = state.fontContext?.tables.cmap.glyphIndexMap?.[unicode || ''];

    if (glyphIndex === undefined) {
      return false;
    }

    try {
      const glyph = fontContext.glyphs.get(Number(glyphIndex));

      if (!glyph) {
        return false;
      }

      const path = glyph.getPath(0, 0, 1024)?.toSVG(10);

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 1024 1024" fill="#ccc">${path?.slice(0, -2)} fill="#ccc" /></svg>`;

      await workspace.fs.writeFile(svgPath, Buffer.from(svg));

      return svgPath;
    } catch (e) {
      console.error(e);
      return false;
    }
  }
};

const createDecoration = async (iconName: string, context: ExtensionContext) => {
  const svgUri = await getSvgFile(iconName, context);
  if (!svgUri) {
    return false;
  }

  const filePath = Uri.file(svgUri.fsPath);
  const options = {
    overviewRulerLane: OverviewRulerLane.Right,
    before: {
      borderColor: '#f00',
    },
    after: {
      margin: '0 0 0 3px',
      contentIconPath: filePath,
      height: `${fontSize}px`,
      width: `${fontSize}px`,
    },
    light: {
      borderColor: '#ccc',
      after: {
        color: 'red',
      },
    },
    dark: {
      borderColor: '#999',
      after: {
        color: 'blue',
      },
    },
  };

  decorationOptionsMap.set(iconName, options);
  return window.createTextEditorDecorationType(options);
};

const getDecoration = async (iconName: string, context: ExtensionContext) => {
  const decoration = decorationMap.get(iconName) || await createDecoration(iconName, context);

  if (!decoration) {
    return false;
  }

  decorationMap.set(iconName, decoration);

  return decoration;
};

const disposeAllDecorations = () => {
  decorationMap.forEach((decoration) => {
    decoration.dispose();
  });
  decorationMap.clear();
};

const fetchFontFile = async () => {
  const iconUrl = workspace.getConfiguration(EXT_NAME).get('iconUrl') as string;

  // get iconFont file
  Log.info(iconUrl ?? '');

  const rst = await fetch(iconUrl ?? '', {
    method: 'GET',
  });

  // parse rst to buffer
  const compressBuffer = await rst.arrayBuffer();

  let buffer = compressBuffer;

  if (iconUrl.endsWith('woff2')) {
    buffer = await decompress(buffer);
  }

  if (buffer.constructor !== ArrayBuffer) { // convert node Buffer
    buffer = new Uint8Array(buffer).buffer;
  }

  const fontContent = await openType.parse(buffer);

  // get icon font list
  state.fontContext = fontContent;

  const styleUrl = workspace.getConfiguration(EXT_NAME).get('styleUrl') as string;

  const styleResponse = await fetch(styleUrl ?? '', {
    method: 'GET',
  });

  const styleText = await styleResponse.text();

  const styleIconList = styleText.match(/.icon(-\w+)+:before\{content:"\\(\w+)"\}/g);

  const styleNameObjectList = styleIconList.map((item: string) => {
    const match = item.split(':before{');

    const iconName = match[0].substring(1);

    const unicode = parseInt(match[1].slice(10, -2), 16);

    return {
      iconName,
      unicode,
    };
  });

  state.iconNameUnicodeMap = new Map(styleNameObjectList.map(item => [item.iconName, item.unicode]));
};

interface IconInfo {
  start: number;
  end: number;
  content: string;
  range: Range;
}
const iconMatchRegex = /icon(-[a-z]+)+/gi;

const loopFind = (lineNumber: number, str: string) => {
  let start = 0;
  const list: IconInfo[] = [];
  let processStr = str;

  // eslint-disable-next-line no-cond-assign
  while (processStr = str.substring(start)) {
    iconMatchRegex.lastIndex = 0;

    const match = iconMatchRegex.exec(processStr);

    if (!match) {
      break;
    }

    list.push({
      start: start + match.index,
      end: start + match.index + match[0].length,
      content: match[0],
      range: new Range(lineNumber, start + match.index, lineNumber, start + match.index + match[0].length),
    });

    start = start + match.index + match[0].length;
  }

  return list;
};

const findIconInfo = (document: TextDocument) => {
  const matches: DecorationOptions[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i);
    const text = line.text.substr(0, 1000);

    matches.push(...loopFind(i, text));
  }
  return matches;
};

export async function activate(context: ExtensionContext) {
  const mode = workspace.getConfiguration(EXT_NAME).get('mode');

  if (mode === 'auto') {
    try {
      const packageBuffer = await workspace.fs.readFile(Uri.joinPath(workspace.workspaceFolders?.[0]?.uri || Uri.file('./'), 'package.json'));
      const packageObj = JSON.parse(packageBuffer.toString());

      if (
        packageObj
        && 'dependencies' in packageObj
        && '@dao-style/core' in packageObj.dependencies
      ) {
        Log.info(`${EXT_NAME} active!`);
      } else {
        Log.info(`${EXT_NAME} disabled caused by no @dao-style/core in dependencies`);
        return;
      }
    } catch (e) {
      Log.info('only support in project with package.json');

      return;
    }
  } else if (mode === 'disable') {
    Log.info(`${EXT_NAME} disabled`);
  }

  // start listening settings
  await fetchFontFile();

  let activeEditor = window.activeTextEditor;

  commands.registerCommand(getCommandName('some-example-command'), (fileUri?: Uri) => {
    if (fileUri) {
      const filePath = getRelativePath(fileUri.toString()) || '';

      Log.info(`[setting info]: ${JSON.stringify(getSettings(), null, 2)}`);

      Log.info(filePath);
    }
  });

  async function updateDecorations() {
    if (!activeEditor) {
      return;
    }

    const matches = await findIconInfo(activeEditor.document);

    const reverseDecorationMap = new Map<TextEditorDecorationType, DecorationOptions[]>();

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];

      if ('content' in match && typeof match.content === 'string') {
        const decoration = await getDecoration(match.content, context);
        if (!decoration) {
          continue;
        }

        const list = reverseDecorationMap.get(decoration) || [];

        list.push(match);

        reverseDecorationMap.set(decoration, list);
      }
    }

    // matches.forEach(async (match) => {
    //   const decoration = await getDecoration(match.content, context);
    //   if (!decoration) {
    //     return;
    //   }

    //   const list = reverseDecorationMap.get(decoration) || [];

    //   list.push(match);

    //   reverseDecorationMap.set(decoration, list);
    // });

    const decorationList = Array.from(reverseDecorationMap.entries());

    decorationList.forEach(([decoration, list]) => {
      activeEditor?.setDecorations(decoration, list);
    });
  }

  let timeout: NodeJS.Timer | undefined;

  function triggerUpdateDecorations(throttle = false) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (throttle) {
      timeout = setTimeout(updateDecorations, 500);
    } else {
      updateDecorations();
    }
  }

  if (activeEditor) {
    triggerUpdateDecorations();
  }

  window.onDidChangeActiveTextEditor((editor) => {
    activeEditor = editor;
    if (editor) {
      triggerUpdateDecorations();
    }
  }, null, context.subscriptions);

  workspace.onDidChangeTextDocument((event) => {
    if (activeEditor && event.document === activeEditor.document) {
      triggerUpdateDecorations(true);
    }
  }, null, context.subscriptions);

  workspace.onDidChangeConfiguration(() => {
    disposeAllDecorations();
    triggerUpdateDecorations();
  });

  // register completion provider
  context.subscriptions.push(
    languages.registerCompletionItemProvider(
      { scheme: 'file' },
      {
        async provideCompletionItems(document: TextDocument, position: Position) {
          const linePrefix = document.lineAt(position).text.substr(0, position.character);

          if (!linePrefix.endsWith('icon-')) {
            return undefined;
          }

          const completionList = await Promise.all(Array.from(state.iconNameUnicodeMap.entries()).map(async ([iconName, unicode]) => {
            const item = new CompletionItem(iconName, CompletionItemKind.Constant);
            const rst = await getDecoration(iconName, context);
            if (!rst) {
              return false;
            }

            const decoration = decorationOptionsMap.get(iconName);

            if (decoration?.after?.contentIconPath) {
              const contentIconPath = decoration?.after?.contentIconPath;
              const md = new MarkdownString();
              md.supportHtml = true;
              const url = (contentIconPath as Uri).toString();

              md.appendMarkdown(`![${iconName}](${url})`);

              item.documentation = md;
              item.label = {
                label: iconName,
              };
            }

            item.insertText = new SnippetString(iconName.slice(5));
            return item;
          }).filter(item => item));

          return completionList as CompletionItem[];
        },
      },
      '-',
    ),
  );
}

// process exit;
export function deactivate() {
  disposeSettingListener();

  Log.info(`${EXT_NAME} deactivate!`);
}
