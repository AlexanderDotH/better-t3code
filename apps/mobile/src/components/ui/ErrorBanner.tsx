import { Notice } from "./Notice";

export function ErrorBanner(props: { readonly message: string }) {
  return <Notice critical tone="danger" message={props.message} />;
}
