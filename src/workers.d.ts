declare module '*.worker?worker&inline' {
  const InlineWorker: new () => Worker;
  export default InlineWorker;
}
