import type { Uri } from 'vscode';
import { commands } from 'vscode';
import { disposeSettingListener, getSettings, initialSetting } from './settings';
import { Log } from './log';
import { getRelativePath } from './utils';
import { EXT_NAME, getCommandName } from './constant';

export function activate() {
  Log.info(`${EXT_NAME} active!`);
  // start listening settings
  initialSetting();

  commands.registerCommand(getCommandName('some-example-command'), (fileUri?: Uri) => {
    if (fileUri) {
      const filePath = getRelativePath(fileUri.toString()) || '';

      Log.info(`[setting info]: ${JSON.stringify(getSettings(), null, 2)}`);

      Log.info(filePath);
    }
  });
}

// process exit;
export function deactivate() {
  disposeSettingListener();

  Log.info(`${EXT_NAME} deactivate!`);
}
