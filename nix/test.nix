{
  testers,
  writeText,
  module,
}:
let
  # scrypt hash of "test-password", generated with bin/hash-password.mjs.
  # Fixed rather than generated at build time so the test can actually log in.
  adminPasswordHashFile = writeText "portfolio-test-hash" "scrypt$16384$8$1$8Kk6GNg86v64DU9/qLAPvw==$XSSfp+1ysln6DnRWeYwO8KaBFPYyCDuNNpMyLQ/FiINJv/uPgRhE1k33zcC9KA8vZamqpMHUbS4ut2eu3YirCQ==";
in
testers.runNixOSTest {
  name = "portfolio";

  nodes.machine = {
    imports = [ module ];

    services.portfolio = {
      enable = true;
      # https, as deployed: the requests below carry X-Forwarded-Proto the
      # way the reverse proxy sets it, so a regression in trusting it shows
      # up as the login being refused.
      siteUrl = "https://site.test";
      blogUrl = "https://blog.test";
      learnUrl = "https://learn.test";
      inherit adminPasswordHashFile;
    };
  };

  # Covers what `nix build` cannot: that the unit starts under the hardening
  # flags, that the state directory is writable by the service user, that
  # LoadCredential lands where the app looks for it, and that the two
  # three hostnames route to different things.
  testScript = ''
    machine.wait_for_unit("portfolio.service")
    machine.wait_for_open_port(4321)

    def curl(args, host="site.test"):
        return machine.succeed(f"curl -sS -H 'Host: {host}' {args}")

    with subtest("serves all three hosts"):
        machine.succeed("curl -fsS -H 'Host: site.test' http://127.0.0.1:4321/healthz")
        assert "Joshua Noel" in curl("http://127.0.0.1:4321/")
        assert "Nothing published yet" in curl("http://127.0.0.1:4321/", host="blog.test")
        assert "Attention and the transformer" in curl("http://127.0.0.1:4321/", host="learn.test")

    with subtest("starts without logging errors"):
        machine.fail("journalctl -u portfolio.service --grep 'ERR_SYSTEM_ERROR|Error:'")

    with subtest("the database landed in the state directory"):
        machine.succeed("test -f /var/lib/portfolio/portfolio.db")
        machine.succeed("test $(stat -c %U /var/lib/portfolio/portfolio.db) = portfolio")

    with subtest("the heap is capped below the unit's memory ceiling"):
        # Left uncapped, V8 sizes its heap against the host's total memory
        # and walks straight through MemoryMax.
        machine.succeed("systemctl show portfolio.service -p MemoryMax | grep -q 805306368")
        pid = machine.succeed("systemctl show -p MainPID --value portfolio.service").strip()
        machine.succeed(
            f"tr '\\0' '\\n' < /proc/{pid}/environ | grep -q -- '--max-old-space-size=384'"
        )

    # What the TLS-terminating proxy forwards for a form on the https page.
    proxied = "-H 'Host: blog.test' -H 'Origin: https://blog.test' -H 'X-Forwarded-Proto: https'"

    with subtest("rejects the wrong password"):
        out = machine.succeed(
            f"curl -sS -o /dev/null -w '%{{redirect_url}}' {proxied} "
            "-d 'username=admin&password=nope' http://127.0.0.1:4321/api/login"
        )
        assert "failed" in out, out

    with subtest("signs in and publishes a post"):
        headers = machine.succeed(
            f"curl -sS -o /dev/null -D - {proxied} "
            "-d 'username=admin&password=test-password' http://127.0.0.1:4321/api/login"
        )
        cookie = next(
            line.split(":", 1)[1].split(";")[0].strip()
            for line in headers.splitlines()
            if line.lower().startswith("set-cookie:")
        )
        assert "; Secure" in headers, headers
        session = f"-H 'Cookie: {cookie}'"

        location = machine.succeed(
            f"curl -sS -o /dev/null -w '%{{redirect_url}}' {session} {proxied} "
            "-X POST http://127.0.0.1:4321/api/posts"
        )
        post_id = location.rstrip("/").split("/")[-1]

        machine.succeed(
            f"curl -fsS {session} {proxied} "
            "-H 'content-type: application/json' -X PUT "
            """-d '{"title":"From the VM","slug":"","excerpt":"","cover_image":null,"""
            """"status":"published","published_at":"","body_md":"Hello from a test."}' """
            f"http://127.0.0.1:4321/api/posts/{post_id}"
        )

    with subtest("the published post is readable on the blog host"):
        page = curl("http://127.0.0.1:4321/from-the-vm", host="blog.test")
        assert "From the VM" in page
        assert "Hello from a test." in page

    with subtest("the main site shows the work, the published post and the contact links"):
        page = curl("http://127.0.0.1:4321/")
        assert 'id="work"' in page
        assert "From the VM" in page
        assert '/from-the-vm"' in page
        assert "Let's talk." in page
        assert 'href="mailto:noelejoshua@gmail.com"' in page
        assert 'href="https://wa.me/18687260860"' in page
        assert 'href="https://www.linkedin.com/in/noelejoshua/"' in page
        assert 'href="https://github.com/joshua-noel"' in page

    with subtest("a lecture is readable at its own address, at every depth"):
        lecture = "http://127.0.0.1:4321/how-language-models-work/attention-and-the-transformer"
        assert "The idea in one paragraph" in curl(lecture, host="learn.test")
        deep = curl(lecture + "?depth=deep", host="learn.test")
        assert '<html lang="en" data-depth="deep"' in deep, deep[:400]
        assert "Check yourself" in curl(lecture + "?depth=tip", host="learn.test")
        assert "Placeholder course" in curl("http://127.0.0.1:4321/placeholder-systems", host="learn.test")
        machine.succeed(
            "curl -sS -o /dev/null -w '%{http_code}' -H 'Host: learn.test' "
            "http://127.0.0.1:4321/how-language-models-work/nothing | grep -q 404"
        )

    with subtest("the /learn prefix and the admin redirect to their canonical hosts"):
        out = machine.succeed(
            "curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Host: site.test' "
            "http://127.0.0.1:4321/learn/how-language-models-work/attention-and-the-transformer"
        )
        assert out == "301 https://learn.test/how-language-models-work/attention-and-the-transformer", out
        out = machine.succeed(
            "curl -sS -o /dev/null -w '%{http_code} %{redirect_url}' -H 'Host: learn.test' "
            "http://127.0.0.1:4321/admin/login"
        )
        assert out == "301 https://blog.test/admin/login", out

    with subtest("unauthenticated writes are refused"):
        machine.succeed(
            f"curl -sS -o /dev/null -w '%{{http_code}}' {proxied} "
            "-X POST http://127.0.0.1:4321/api/posts "
            "| grep -q 401"
        )
  '';
}
