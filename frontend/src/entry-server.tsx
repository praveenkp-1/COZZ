import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
} from "@tanstack/react-query";
import App from "./App";
import type { Store, Product, ProductList } from "./types";
export function render(
  url: string,
  data: {
    store: Store;
    products?: { params: string; value: ProductList }[];
    product?: Product;
  },
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["store"], data.store);
  for (const p of data.products ?? [])
    client.setQueryData(["products", p.params], p.value);
  if (data.product)
    client.setQueryData(["product", data.product.slug], data.product);
  const html = renderToString(
    <QueryClientProvider client={client}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </QueryClientProvider>,
  );
  return { html, state: dehydrate(client) };
}
