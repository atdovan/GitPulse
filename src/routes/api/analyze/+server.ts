import { Octokit } from 'octokit';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

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
  suggestions: string[];
  improvements: string[];
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

    // Extract owner and repo from the pathname
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2) {
      return json(
        { error: 'URL must include owner and repository name (e.g., https://github.com/owner/repo).' },
        { status: 400 }
      );
    }

    // Take the first two segments as owner and repo, ignoring extra paths (e.g., /tree/main)
    const owner = pathParts[0];
    const repo = pathParts[1];

    console.log('Extracted owner:', owner, 'repo:', repo); // Debug log

    // Initialize Octokit with or without token
    const octokit = token 
      ? new Octokit({ auth: token })
      : new Octokit();

    try {
      // Fetch repository information
      const repoInfo = await octokit.rest.repos.get({
        owner,
        repo,
      });

      // Fetch repository contents (root directory)
      const contents = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: '',
      });

      // Analyze the repository
      const analysis: Analysis = {
        basicInfo: {
          name: repoInfo.data.name,
          description: repoInfo.data.description,
          stars: repoInfo.data.stargazers_count,
          forks: repoInfo.data.forks_count,
          openIssues: repoInfo.data.open_issues_count,
          language: repoInfo.data.language,
          isPrivate: repoInfo.data.private,
        },
        suggestions: [],
        improvements: [],
        vulnerabilities: [],
      };

      // Add suggestions based on repository analysis
      if (!repoInfo.data.description) {
        analysis.suggestions.push('Add a repository description to help others understand your project.');
      }

      const files = Array.isArray(contents.data) ? contents.data : [contents.data];
      
      if (!files.some(file => file.name.toLowerCase() === 'readme.md')) {
        analysis.suggestions.push('Add a README.md file to document your project.');
      }

      if (!files.some(file => file.name.toLowerCase() === 'license')) {
        analysis.suggestions.push('Consider adding a license file to specify usage terms.');
      }

      // Add security checks
      if (!files.some(file => file.name.toLowerCase() === '.gitignore')) {
        analysis.vulnerabilities.push('Add a .gitignore file to prevent sensitive information from being committed.');
      }

      return json(analysis);
    } catch (error: any) {
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
      throw error;
    }
  } catch (error: any) {
    console.error('Error analyzing repository:', error);
    return json(
      { error: 'Failed to analyze repository. Please check the URL and try again.' },
      { status: 500 }
    );
  }
}