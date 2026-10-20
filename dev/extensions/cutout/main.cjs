// The cutout extension, main-process part: 圖片去背, a tool in the app menu's 工具 (pages/editor.js). Photos stay
// on this computer; only the model is downloaded, once (engine.cjs). See the app's extensions.cjs for what an
// extension provides.
const path = require('node:path');
const { createEngine } = require('./engine.cjs');

exports.activate = context => {
  const engine = createEngine({
    folder: path.join(context.dataFolder, 'Model'), offline: context.offline, userAgent: 'CharacterDesktop/' + context.appVersion, log: context.log,
    runtime: () => require(path.join(__dirname, 'node_modules', 'onnxruntime-node'))
  });
  return {
    pageCalls: {
      status: engine.status,
      fetchModel: engine.fetchModel,
      remove: input => engine.remove(input),
      release: engine.release
    }
  };
};
