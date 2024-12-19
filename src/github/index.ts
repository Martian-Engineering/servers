#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateBranchOptionsSchema,
  CreateBranchSchema,
  CreateIssueOptionsSchema,
  CreateIssueSchema,
  CreateOrUpdateFileSchema,
  CreatePullRequestOptionsSchema,
  CreatePullRequestSchema,
  CreateRepositoryOptionsSchema,
  CreateRepositorySchema,
  ForkRepositorySchema,
  GetFileContentsSchema,
  GetIssueSchema,
  GitHubCommitSchema,
  GitHubContentSchema,
  GitHubCreateUpdateFileResponseSchema,
  GitHubForkSchema,
  GitHubIssueSchema,
  GitHubListCommits,
  GitHubListCommitsSchema,
  GitHubPullRequestSchema,
  GitHubReferenceSchema,
  GitHubRepositorySchema,
  GitHubSearchResponseSchema,
  GitHubTreeSchema,
  IssueCommentSchema,
  ListCommitsSchema,
  ListIssuesOptionsSchema,
  PushFilesSchema,
  SearchCodeResponseSchema,
  SearchGistsResponseSchema,
  SearchGistsSchema,
  SearchCodeSchema,
  SearchIssuesResponseSchema,
  SearchIssuesSchema,
  SearchRepositoriesSchema,
  SearchUsersResponseSchema,
  SearchUsersSchema,
  UpdateIssueOptionsSchema,
  type FileOperation,
  type SearchGistsResponse,
  type GitHubCommit,
  type GitHubContent,
  type GitHubCreateUpdateFileResponse,
  type GitHubFork,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubReference,
  type GitHubRepository,
  type GitHubSearchResponse,
  type GitHubTree,
  type SearchCodeResponse,
  type SearchIssuesResponse,
  type SearchUsersResponse,
  type IssueComment
} from './schemas.js';

const server = new Server(
  {
    name: "github-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const GITHUB_PERSONAL_ACCESS_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

if (!GITHUB_PERSONAL_ACCESS_TOKEN) {
  console.error("GITHUB_PERSONAL_ACCESS_TOKEN environment variable is not set");
  process.exit(1);
}

async function forkRepository(
  owner: string,
  repo: string,
  organization?: string
): Promise<GitHubFork> {
  const url = organization
    ? `https://api.github.com/repos/${owner}/${repo}/forks?organization=${organization}`
    : `https://api.github.com/repos/${owner}/${repo}/forks`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubForkSchema.parse(await response.json());
}

async function createBranch(
  owner: string,
  repo: string,
  options: z.infer<typeof CreateBranchOptionsSchema>
): Promise<GitHubReference> {
  const fullRef = `refs/heads/${options.ref}`;

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: fullRef,
        sha: options.sha,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubReferenceSchema.parse(await response.json());
}

async function getDefaultBranchSHA(
  owner: string,
  repo: string
): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`,
    {
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
      },
    }
  );

  if (!response.ok) {
    const masterResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/master`,
      {
        headers: {
          Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "github-mcp-server",
        },
      }
    );

    if (!masterResponse.ok) {
      throw new Error(
        "Could not find default branch (tried 'main' and 'master')"
      );
    }

    const data = GitHubReferenceSchema.parse(await masterResponse.json());
    return data.object.sha;
  }

  const data = GitHubReferenceSchema.parse(await response.json());
  return data.object.sha;
}

async function getFileContents(
  owner: string,
  repo: string,
  path: string,
  branch?: string
): Promise<GitHubContent> {
  let url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  if (branch) {
    url += `?ref=${branch}`;
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  const data = GitHubContentSchema.parse(await response.json());

  // If it's a file, decode the content
  if (!Array.isArray(data) && data.content) {
    data.content = Buffer.from(data.content, "base64").toString("utf8");
  }

  return data;
}

async function createOrUpdateFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<GitHubCreateUpdateFileResponse> {
  const encodedContent = Buffer.from(content).toString("base64");

  let currentSha = sha;
  if (!currentSha) {
    try {
      const existingFile = await getFileContents(owner, repo, path, branch);
      if (!Array.isArray(existingFile)) {
        currentSha = existingFile.sha;
      }
    } catch (error) {
      console.error(
        "Note: File does not exist in branch, will create new file"
      );
    }
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const body = {
    message,
    content: encodedContent,
    branch,
    ...(currentSha ? { sha: currentSha } : {}),
  };

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubCreateUpdateFileResponseSchema.parse(await response.json());
}

async function createTree(
  owner: string,
  repo: string,
  files: FileOperation[],
  baseTree?: string
): Promise<GitHubTree> {
  const tree = files.map((file) => ({
    path: file.path,
    mode: "100644" as const,
    type: "blob" as const,
    content: file.content,
  }));

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tree,
        base_tree: baseTree,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubTreeSchema.parse(await response.json());
}

async function createCommit(
  owner: string,
  repo: string,
  message: string,
  tree: string,
  parents: string[]
): Promise<GitHubCommit> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        tree,
        parents,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubCommitSchema.parse(await response.json());
}

async function updateReference(
  owner: string,
  repo: string,
  ref: string,
  sha: string,
  force: boolean = false
): Promise<GitHubReference> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/${ref}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sha,
        force,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubReferenceSchema.parse(await response.json());
}

async function pushFiles(
  owner: string,
  repo: string,
  branch: string,
  files: FileOperation[],
  message: string
): Promise<void> {
  // Get the SHA of the latest commit in the branch
  const branchResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
      },
    }
  );

  if (!branchResponse.ok) {
    throw new Error(`GitHub API error: ${branchResponse.statusText}`);
  }

  const branchData = GitHubReferenceSchema.parse(await branchResponse.json());
  const latestCommitSha = branchData.object.sha;

  // Create a new tree with the files
  const tree = await createTree(owner, repo, files, latestCommitSha);

  // Create a new commit
  const commit = await createCommit(owner, repo, message, tree.sha, [latestCommitSha]);

  // Update the reference to point to the new commit
  await updateReference(owner, repo, `heads/${branch}`, commit.sha);
}

export async function searchGists(
  params: z.infer<typeof SearchGistsSchema>
): Promise<SearchGistsResponse> {
  const url = new URL("https://api.github.com/search/gists");
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return SearchGistsResponseSchema.parse(await response.json());
}

async function searchRepositories(
  query: z.infer<typeof SearchRepositoriesSchema>
): Promise<GitHubSearchResponse> {
  const url = new URL("https://api.github.com/search/repositories");
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubSearchResponseSchema.parse(await response.json());
}

async function searchCode(
  query: z.infer<typeof SearchCodeSchema>
): Promise<SearchCodeResponse> {
  const url = new URL("https://api.github.com/search/code");
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return SearchCodeResponseSchema.parse(await response.json());
}

async function searchIssues(
  query: z.infer<typeof SearchIssuesSchema>
): Promise<SearchIssuesResponse> {
  const url = new URL("https://api.github.com/search/issues");
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return SearchIssuesResponseSchema.parse(await response.json());
}

async function searchUsers(
  query: z.infer<typeof SearchUsersSchema>
): Promise<SearchUsersResponse> {
  const url = new URL("https://api.github.com/search/users");
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return SearchUsersResponseSchema.parse(await response.json());
}

async function createRepository(
  options: z.infer<typeof CreateRepositoryOptionsSchema>
): Promise<GitHubRepository> {
  const response = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubRepositorySchema.parse(await response.json());
}

async function listCommits(
  owner: string,
  repo: string,
  options?: z.infer<typeof ListCommitsSchema>
): Promise<GitHubListCommits> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  if (options) {
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubListCommitsSchema.parse(await response.json());
}

async function listIssues(
  owner: string,
  repo: string,
  options?: z.infer<typeof ListIssuesOptionsSchema>
): Promise<GitHubIssue[]> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
  if (options) {
    Object.entries(options).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value.toString());
      }
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "github-mcp-server",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return z.array(GitHubIssueSchema).parse(await response.json());
}

async function getIssue(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GitHubIssue> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubIssueSchema.parse(await response.json());
}

async function createIssue(
  owner: string,
  repo: string,
  options: z.infer<typeof CreateIssueOptionsSchema>
): Promise<GitHubIssue> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubIssueSchema.parse(await response.json());
}

async function createPullRequest(
  owner: string,
  repo: string,
  options: z.infer<typeof CreatePullRequestOptionsSchema>
): Promise<GitHubPullRequest> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubPullRequestSchema.parse(await response.json());
}

async function updateIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options: z.infer<typeof UpdateIssueOptionsSchema>
): Promise<GitHubIssue> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return GitHubIssueSchema.parse(await response.json());
}

async function addIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<IssueComment> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "github-mcp-server",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.statusText}`);
  }

  return IssueCommentSchema.parse(await response.json());
}

// Tool definitions
const tools = {
  fork_repository: {
    schema: zodToJsonSchema(ForkRepositorySchema),
    handler: async (params: z.infer<typeof ForkRepositorySchema>) => {
      return forkRepository(params.owner, params.repo, params.organization);
    },
  },
  create_branch: {
    schema: zodToJsonSchema(CreateBranchSchema),
    handler: async (params: z.infer<typeof CreateBranchSchema>) => {
      let sha = params.from_branch;
      if (!sha) {
        sha = await getDefaultBranchSHA(params.owner, params.repo);
      }
      return createBranch(params.owner, params.repo, {
        ref: params.branch,
        sha,
      });
    },
  },
  get_file_contents: {
    schema: zodToJsonSchema(GetFileContentsSchema),
    handler: async (params: z.infer<typeof GetFileContentsSchema>) => {
      return getFileContents(params.owner, params.repo, params.path, params.branch);
    },
  },
  create_or_update_file: {
    schema: zodToJsonSchema(CreateOrUpdateFileSchema),
    handler: async (params: z.infer<typeof CreateOrUpdateFileSchema>) => {
      return createOrUpdateFile(
        params.owner,
        params.repo,
        params.path,
        params.content,
        params.message,
        params.branch,
        params.sha
      );
    },
  },
  push_files: {
    schema: zodToJsonSchema(PushFilesSchema),
    handler: async (params: z.infer<typeof PushFilesSchema>) => {
      await pushFiles(
        params.owner,
        params.repo,
        params.branch,
        params.files,
        params.message
      );
      return { success: true };
    },
  },
  search_gists: {
    schema: zodToJsonSchema(SearchGistsSchema),
    handler: async (params: z.infer<typeof SearchGistsSchema>) => {
      return searchGists(params);
    },
  },
  search_repositories: {
    schema: zodToJsonSchema(SearchRepositoriesSchema),
    handler: async (params: z.infer<typeof SearchRepositoriesSchema>) => {
      return searchRepositories(params);
    },
  },
  search_code: {
    schema: zodToJsonSchema(SearchCodeSchema),
    handler: async (params: z.infer<typeof SearchCodeSchema>) => {
      return searchCode(params);
    },
  },
  search_issues: {
    schema: zodToJsonSchema(SearchIssuesSchema),
    handler: async (params: z.infer<typeof SearchIssuesSchema>) => {
      return searchIssues(params);
    },
  },
  search_users: {
    schema: zodToJsonSchema(SearchUsersSchema),
    handler: async (params: z.infer<typeof SearchUsersSchema>) => {
      return searchUsers(params);
    },
  },
  get_issue: {
    schema: zodToJsonSchema(GetIssueSchema),
    handler: async (params: z.infer<typeof GetIssueSchema>) => {
      return getIssue(params.owner, params.repo, params.issue_number);
    },
  },
  create_issue: {
    schema: zodToJsonSchema(CreateIssueSchema),
    handler: async (params: z.infer<typeof CreateIssueSchema>) => {
      return createIssue(params.owner, params.repo, params);
    },
  },
  create_repository: {
    schema: zodToJsonSchema(CreateRepositorySchema),
    handler: async (params: z.infer<typeof CreateRepositorySchema>) => {
      return createRepository(params);
    },
  },
  create_issue: {
    schema: zodToJsonSchema(CreateIssueSchema),
    handler: async (params: z.infer<typeof CreateIssueSchema>) => {
      const { owner, repo, ...options } = params;
      return createIssue(owner, repo, options);
    },
  },
  create_pull_request: {
    schema: zodToJsonSchema(CreatePullRequestSchema),
    handler: async (params: z.infer<typeof CreatePullRequestSchema>) => {
      const { owner, repo, ...options } = params;
      return createPullRequest(owner, repo, options);
    },
  },
  list_commits: {
    schema: zodToJsonSchema(ListCommitsSchema),
    handler: async (params: z.infer<typeof ListCommitsSchema>) => {
      return listCommits(params.owner, params.repo, params);
    },
  },
  add_issue_comment: {
    schema: zodToJsonSchema(IssueCommentSchema),
    handler: async (params: any) => {
      const { owner, repo, issue_number, body } = params;
      return addIssueComment(owner, repo, issue_number, body);
    },
  },
  list_issues: {
    schema: zodToJsonSchema(ListIssuesOptionsSchema),
    handler: async (params: any) => {
      const { owner, repo, ...options } = params;
      return listIssues(owner, repo, options);
    },
  },
  update_issue: {
    schema: zodToJsonSchema(UpdateIssueOptionsSchema),
    handler: async (params: any) => {
      const { owner, repo, issue_number, ...options } = params;
      return updateIssue(owner, repo, issue_number, options);
    },
  },
  create_gist: {
    schema: zodToJsonSchema(CreateGistSchema),
    handler: async (params: z.infer<typeof CreateGistSchema>) => {
      const response = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'github-mcp-server',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API error (${response.status}): ${errorData.message || response.statusText}`);
      }

      return response.json();
    },
  },
};

// Server setup
server.capabilities.tools = tools;

// Request handlers
server.listToolsHandler = async (request: z.infer<typeof ListToolsRequestSchema>) => {
  return {
    tools: Object.entries(tools).map(([name, tool]) => ({
      name,
      description: tool.schema.description || "",
      schema: tool.schema,
    })),
  };
};

server.callToolHandler = async (request: z.infer<typeof CallToolRequestSchema>) => {
  const tool = tools[request.name as keyof typeof tools];
  if (!tool) {
    throw new Error(`Unknown tool: ${request.name}`);
  }

  try {
    return tool.handler(request.parameters);
  } catch (error) {
    console.error(`Error in ${request.name}:`, error);
    throw error;
  }
};

// Start the server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GitHub MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});// List gists with optional parameters
async function listGists(params: {
  since?: string;
  per_page?: number;
  page?: number;
}): Promise<SearchGistsResponse> {
  const url = new URL('https://api.github.com/gists');
  
  if (params.since) {
    url.searchParams.append('since', params.since);
  }
  if (params.per_page) {
    url.searchParams.append('per_page', params.per_page.toString());
  }
  if (params.page) {
    url.searchParams.append('page', params.page.toString());
  }

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `token ${GITHUB_PERSONAL_ACCESS_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'github-mcp-server',
      },
    });

    // Handle rate limiting
    const rateLimitRemaining = parseInt(response.headers.get('x-ratelimit-remaining') || '0');
    const rateLimitReset = parseInt(response.headers.get('x-ratelimit-reset') || '0');

    if (response.status === 403 && rateLimitRemaining === 0) {
      const resetDate = new Date(rateLimitReset * 1000);
      throw new Error(
        `GitHub API rate limit exceeded. Rate limit will reset at ${resetDate.toISOString()}`
      );
    }

    // Handle other error responses
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        `GitHub API error (${response.status}): ${errorData.message || response.statusText}`
      );
    }

    const data = await response.json();
    // Transform the response to match our schema
    return {
      total_count: data.length,
      incomplete_results: false,
      items: data
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('GitHub API')) {
      throw error;
    }
    throw new Error(`Error listing gists: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Search public gists (using public gists endpoint and filtering)
async function searchGists(
  params: z.infer<typeof SearchGistsSchema>
): Promise<SearchGistsResponse> {
  // First get the gists
  const gists = await listGists({
    per_page: params.per_page,
    page: params.page
  });

  // Parse search query
  const searchTerms = params.q.toLowerCase().split(' ');
  const languageFilter = searchTerms.find(term => term.startsWith('language:'))?.split(':')[1];
  const keywords = searchTerms.filter(term => !term.startsWith('language:'));

  // Filter gists based on search criteria
  const filteredItems = gists.items.filter(gist => {
    // Check language filter
    if (languageFilter) {
      const hasMatchingFile = Object.values(gist.files).some(
        file => file.language?.toLowerCase() === languageFilter
      );
      if (!hasMatchingFile) return false;
    }

    // Check keywords
    if (keywords.length > 0) {
      const searchableText = [
        gist.description,
        ...Object.values(gist.files).map(f => f.filename)
      ].filter(Boolean).join(' ').toLowerCase();
      
      return keywords.every(keyword => searchableText.includes(keyword));
    }

    return true;
  });

  // Sort results if requested
  if (params.sort) {
    filteredItems.sort((a, b) => {
      switch (params.sort) {
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        default:
          return 0;
      }
    });

    if (params.order === 'asc') {
      filteredItems.reverse();
    }
  }

  return {
    total_count: filteredItems.length,
    incomplete_results: false,
    items: filteredItems
  };
}