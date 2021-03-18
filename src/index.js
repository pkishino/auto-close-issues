const fs = require("fs");
const core = require("@actions/core");
const github = require("@actions/github");
const mdjson = require("mdjson");
const codeBlocks = require('gfm-code-blocks');

const ISSUE_TEMPLATE_DIR = ".github/ISSUE_TEMPLATE";

// Grab the closing message from params or fallback to a default message
const getIssueCloseMessage = () => {
  const message =
    core.getInput("issue-close-message") ||
    "@${issue.user.login}: hello! :wave:\n\nThis issue is being automatically closed because it does not follow the issue template.";

  const { payload } = github.context;

  return Function(
    ...Object.keys(payload),
    `return \`${message}\``
  )(...Object.values(payload));
};

async function run() {
  try {

    const client = new github.getOctokit(
      core.getInput("github-token", { required: true })
    );

    const { payload } = github.context;
    console.log(payload);
    const issueBodyMarkdown = payload.issue.body;
    // Get all the markdown titles from the issue body
    const issueBodyTitles = Object.keys(mdjson(issueBodyMarkdown));
    // Get a list of the templates
    const issueTemplates = fs.readdirSync(ISSUE_TEMPLATE_DIR).filter(fileName =>  fileName.endsWith('.md'));
    
    const cbs=codeBlocks(issueBodyMarkdown);
    
    // Check if code blocks are valid
    const codeBlocksValid = cbs.every(block => {
      // check that it doesn't match placeholder and isn't empty
      const match = block.code !== '\n<placeholder>\r\n' && block.code !== '\n<-- Paste here -->\r\n' && block.code.length > 0;
      return match;
    });

    //Check for all boxes ticked
    const countUnticked = (issueBodyMarkdown.match(/- \[(?![xX]+\])[\s]*[xX]*[\s]*\]/g)|| []).length;

    // Compare template titles with issue body
    const isIssueValid = issueTemplates.some(template => {
      const templateMarkdown = fs.readFileSync(
        `${ISSUE_TEMPLATE_DIR}/${template}`,
        "utf-8"
      );
      // Check if all titles are there
      const templateTitles = Object.keys(mdjson(templateMarkdown));
      return templateTitles.every(title => issueBodyTitles.includes(title));
    });

    const { issue } = github.context;
    const closedIssueLabel = core.getInput("closed-issues-label");

    if (isIssueValid && codeBlocksValid && countUnticked==0) {
      // Only reopen the issue if there's a `closed-issues-label` so it knows that
      // it was previously closed because of the wrong template
      if (payload.issue.state === "closed" && closedIssueLabel) {
        const labels = (
          await client.issues.listLabelsOnIssue({
            owner: issue.owner,
            repo: issue.repo,
            issue_number: issue.number
          })
        ).data.map(({ name }) => name);

        if (!labels.includes(closedIssueLabel)) {
          return;
        }

        await client.issues.removeLabel({
          owner: issue.owner,
          repo: issue.repo,
          issue_number: issue.number,
          name: closedIssueLabel
        });

        await client.issues.update({
          owner: issue.owner,
          repo: issue.repo,
          issue_number: issue.number,
          state: "open"
        });

        return;
      }
      return;
    }

    // If an closed issue label was provided, add it to the issue
    if (closedIssueLabel) {
      await client.issues.addLabels({
        owner: issue.owner,
        repo: issue.repo,
        issue_number: issue.number,
        labels: [closedIssueLabel]
      });
    }

    // Add the issue closing comment
    await client.issues.createComment({
      owner: issue.owner,
      repo: issue.repo,
      issue_number: issue.number,
      body: getIssueCloseMessage()
    });

    // Close the issue
    await client.issues.update({
      owner: issue.owner,
      repo: issue.repo,
      issue_number: issue.number,
      state: "closed"
    });
  } catch (error) {
      core.error(error);
      core.setFailed(error.message);
    }
};

run();