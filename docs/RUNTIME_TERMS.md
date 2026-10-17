# Third-party runtime terms

JobChat's Apache-2.0 license applies to JobChat's own source code. It does not
relicense third-party packages or grant rights to hosted model services.

## Claude Agent SDK and bundled Claude Code binary

The `@anthropic-ai/claude-agent-sdk` npm packages are proprietary:
**© Anthropic PBC. All rights reserved.** Their license notice is preserved in
`licenses/ANTHROPIC-CLAUDE-AGENT-SDK.md`.

By installing or deploying JobChat, you are responsible for reviewing and
complying with Anthropic's applicable agreements:
https://code.claude.com/docs/en/legal-and-compliance

In particular, the published terms describe requirements that include:

- using the Claude Code binary as published by Anthropic, without modifying it
  or disabling its authentication methods;
- agreeing to the applicable Commercial Terms of Service when offering Claude
  Code in products or services;
- not reselling, paying for, or intermediating Claude usage on end users'
  behalf except where the terms expressly permit provisioning for your own
  authorized users;
- ensuring usage is authenticated and billed under the appropriate user's own
  Anthropic or supported inference-provider agreement.

The JobChat source repository does not vendor the SDK package or its binary.
Users obtain them from npm during dependency installation. Any container image
you build and distribute will include those packages, so the same terms apply
to that distribution.

This section is a compliance aid, not legal advice. Review the current official
terms before offering a hosted service or distributing a prebuilt image.
