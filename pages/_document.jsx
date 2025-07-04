import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; img-src 'self' https://ipfs.io https://pbs.twimg.com https://coin-images.coingecko.com; connect-src 'self' https://api.geckoterminal.com https://api.coingecko.com https://api.sim.dune.com https://www.google.com https://www.recaptcha.net; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.recaptcha.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}