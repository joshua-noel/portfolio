{
  lib,
  stdenvNoCC,
  nodejs_24,
  pnpm_10,
  fetchPnpmDeps,
  pnpmConfigHook,
  makeWrapper,
}:
let
  # Single source of truth: npm and Nix cannot disagree about the version.
  packageJson = lib.importJSON ../package.json;
  nodejs = nodejs_24;
  # pnpm 11 is crashing at teardown inside nix builds on darwin, and
  # fetcherVersion 3 -- what every pnpm package in nixpkgs uses today -- is
  # rejected for pnpm 11. Both point at the same pin.
  pnpm = pnpm_10;
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "portfolio";
  inherit (packageJson) version;

  # Explicit fileset rather than cleanSource: node_modules and dist must
  # never reach the store, and editing the README should not invalidate a
  # build.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../astro.config.mjs
      ../tsconfig.json
      ../src
      ../content
      ../bin
      ../test
    ];
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    inherit pnpm;
    # 1 and 2 were removed in 26.11; 4 is pnpm 11 only.
    fetcherVersion = 3;
    hash = "sha256-GxqaBxI8QLnzh9ZmXP1owRK1TTFVOh15aHif6cIwRuU=";
  };

  nativeBuildInputs = [
    nodejs
    pnpm
    pnpmConfigHook
    makeWrapper
  ];

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  # Covers the logic that fails silently. Astro pages are left out on
  # purpose -- those fail loudly.
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    node --test 'test/*.test.ts'
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    # No node_modules: astro.config.mjs sets ssr.noExternal, so dist/server
    # is self-contained. Shipping the tree instead would drag in ~300 MB of
    # rolldown and esbuild binaries for every platform, none of which a
    # running server ever executes.
    mkdir -p $out/lib/portfolio
    cp -r dist bin content package.json $out/lib/portfolio/

    makeWrapper ${nodejs}/bin/node $out/bin/portfolio \
      --add-flags $out/lib/portfolio/bin/serve.mjs
    makeWrapper ${nodejs}/bin/node $out/bin/portfolio-hash-password \
      --add-flags $out/lib/portfolio/bin/hash-password.mjs

    runHook postInstall
  '';

  passthru = { inherit nodejs; };

  meta = {
    description = "Personal site and blog for Joshua Noel";
    homepage = "https://noelejoshua.com";
    mainProgram = "portfolio";
    platforms = lib.platforms.unix;
  };
})
