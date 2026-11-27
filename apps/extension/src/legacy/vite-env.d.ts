declare module "monaco-editor/esm/vs/editor/editor.worker.js?worker" {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module "monaco-editor/esm/vs/language/json/json.worker.js?worker" {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}
