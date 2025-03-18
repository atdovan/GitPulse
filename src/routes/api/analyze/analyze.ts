import { Octokit } from 'octokit';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { OpenAI } from 'openai';
import { env } from '$env/dynamic/private'; // Load environment variables
import type { RestEndpointMethodTypes } from '@octokit/rest';

// Define types based on Octokit response
type ContentItem = RestEndpointMethodTypes['repos']['getContent']['response']['data'] extends (infer T)[]
  ? T
  : RestEndpointMethodTypes['repos']['getContent']['response']['data'];
type ContentResponse = RestEndpointMethodTypes['repos']['getContent']['response'];

interface Analysis {
  basicInfo: {
    name: string;
    description: string | null;
    stars: number;
    forks: number;
    openIssues: number;
    language: string | null;
    isPrivate: boolean;
  };
  fileAnalyses: {
    path: string;
    good: string[];
    bad: string[];
    improvements: string[];
    deepAnalysisPending: boolean;
  }[];
  suggestions: string[];
  vulnerabilities: string[];
}

export async function POST({ request }: RequestEvent) {
  try {
    const { repoUrl, token } = await request.json();

    // Validate and parse the GitHub URL
    let url;
    try {
      url = new URL(repoUrl);
    } catch (e) {
      return json(
        { error: 'Invalid URL format. Please provide a valid GitHub repository URL (e.g., https://github.com/owner/repo).' },
        { status: 400 }
      );
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      return json(
        { error: 'URL must include owner and repository name (e.g., https://github.com/owner/repo).' },
        { status: 400 }
      );
    }

    const owner = pathParts[0];
    const repo = pathParts[1];

    // Initialize Octokit
    const octokit = token ? new Octokit({ auth: token }) : new Octokit();

    // Fetch repository info
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    const isPrivate = repoInfo.data.private;

    // Initialize OpenAI
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    // Recursively fetch all files
    async function getAllFiles(path: string = ''): Promise<{ path: string; content: string }[]> {
      try {
        const contentsResponse: ContentResponse = await octokit.rest.repos.getContent({ owner, repo, path });
        console.log('Contents response:', contentsResponse); // Debug log
        if (!contentsResponse.data) {
          console.warn(`No data returned for path: ${path}`);
          return [];
        }

        let files: { path: string; content: string }[] = [];
        const items = Array.isArray(contentsResponse.data) ? contentsResponse.data : [contentsResponse.data];

        for (const item of items) {
          if (item.type === 'file') {
            const fileExt = item.name.split('.').pop()?.toLowerCase();
            if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'cs', 'rb', 'php'].includes(fileExt || '')) {
              const contentResponse = await octokit.rest.repos.getContent({ owner, repo, path: item.path });
              const contentItem = contentResponse.data;
              if ('content' in contentItem && contentItem.content) {
                files.push({
                  path: item.path,
                  content: Buffer.from(contentItem.content, 'base64').toString('utf-8'),
                });
              } else {
                console.warn(`No content found for file: ${item.path}`);
              }
            }
          } else if (item.type === 'dir' && !item.path.includes('node_modules') && !item.path.includes('target')) {
            files = files.concat(await getAllFiles(item.path));
          }
          // Ignore 'submodule' and 'symlink' types
        }
        return files;
      } catch (error) {
        console.error(`Error fetching files for path ${path}:`, error);
        return [];
      }
    }

    const files = await getAllFiles();

    // Analyze each file with OpenAI
    const fileAnalyses = await Promise.all(files.map(async (file) => {
      const prompt = `Analyze the following code file content:\n\n${file.content}\n\nProvide a list of up to 3 good aspects, 3 bad aspects, and 3 potential improvements. Format as JSON: { "good": ["point1", "point2", "point3"], "bad": ["point1", "point2", "point3"], "improvements": ["point1", "point2", "point3"] }.`;
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      return {
        path: file.path,
        good: result.good || [],
        bad: result.bad || [],
        improvements: result.improvements || [],
        deepAnalysisPending: true,
      };
    }));

    // Construct analysis object
    const analysis: Analysis = {
      basicInfo: {
        name: repoInfo.data.name,
        description: repoInfo.data.description,
        stars: repoInfo.data.stargazers_count,
        forks: repoInfo.data.forks_count,
        openIssues: repoInfo.data.open_issues_count,
        language: repoInfo.data.language,
        isPrivate,
      },
      fileAnalyses,
      suggestions: [],
      vulnerabilities: [],
    };

    // Add general suggestions and vulnerabilities (if any)
    if (!repoInfo.data.description) {
      analysis.suggestions.push('Add a repository description to help others understand your project.');
    }

    return json(analysis);
  } catch (error: any) {
    console.error('Error analyzing repository:', error);
    if (error.status === 404) {
      return json(
        { error: 'Repository not found. Please check the URL and ensure it points to a valid public repository.' },
        { status: 404 }
      );
    } else if (error.status === 401) {
      return json(
        { error: 'Invalid GitHub token provided.' },
        { status: 401 }
      );
    } else if (error.status === 403) {
      return json(
        { error: 'This is a private repository. Please provide a valid GitHub token to access it.' },
        { status: 403 }
      );
    }
    return json(
      { error: 'Failed to analyze repository. Please check the URL and try again.' },
      { status: 500 }
    );
  }
}