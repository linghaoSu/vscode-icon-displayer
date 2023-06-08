import { type Disposable, window, workspace } from 'vscode';
import { EXT_NAME } from './constant';

let disposeHandler: Disposable | undefined;

interface SettingInterface {
  iconUrl?: string;
  iconStyle?: {
    color?: string;
  };
}

type SettingType = SettingInterface;

const defaultSettings: SettingType = {
  iconUrl: '',
};

const currentSettings: SettingType = {
  ...defaultSettings,
};

export const applyChange = (params: SettingType = {}) => {
  Object.assign(currentSettings, params);
};

export function initialSetting() {
  if (disposeHandler) {
    disposeSettingListener();
  }

  applyChange(workspace.getConfiguration(EXT_NAME) as SettingType);

  disposeHandler = workspace.onDidChangeConfiguration(async (e) => {
    const isChanged = await e.affectsConfiguration(EXT_NAME);

    if (isChanged) {
      window.showInformationMessage('changed!');
    }
  });
}

export function disposeSettingListener() {
  if (disposeHandler) {
    disposeHandler.dispose();
    disposeHandler = undefined;
  }
}

export function getSettings() {
  return currentSettings;
}
