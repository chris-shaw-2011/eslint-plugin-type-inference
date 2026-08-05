declare global {
  namespace JSX {
    interface Element { readonly tag: string }
    interface IntrinsicElements { div: {} }
  }
}
const view = (): JSX.Element => <div />;
void view;
export {};
