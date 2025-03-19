import { Octokit } from 'octokit';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { OpenAI } from 'openai';
import { env } from '$env/dynamic/private';

// In-memory store for analysis results
const analysisStore: Map<string, Analysis> = new Map();

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
  status: 'pending' | 'completed' | 'failed';
}

export async function POST({ request }: RequestEvent) {
  try {
    const { repoUrl, token } = await request.json();
    console.log('Received:', { repoUrl, token: token ? 'provided' : 'none' });

    const url = new URL(repoUrl);
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo) {
      return json({ error: 'Invalid URL format.' }, { status: 400 });
    }
    console.log('Parsed:', { owner, repo });

    const octokit = new Octokit({ auth: token || undefined });
    console.log('Fetching repo info...');
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    console.log('Repo:', repoInfo.data.name);

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
      fileAnalyses: [],
      suggestions: [],
      vulnerabilities: [],
      status: 'completed', // Set to completed since no AI
    };

    if (!repoInfo.data.description) {
      analysis.suggestions.push('Add a repository description.');
    }

    // Comment out AI analysis
    /*
    const key = `${owner}/${repo}`;
    analysisStore.set(key, analysis);

    if (env.OPENAI_API_KEY) {
      startAIAnalysis(octokit, key, owner, repo).catch(err => {
        console.error('AI analysis failed:', err.message);
        const stored = analysisStore.get(key);
        if (stored) {
          stored.status = 'failed';
          stored.fileAnalyses = [];
          analysisStore.set(key, stored);
        }
      });
    } else {
      console.warn('No OpenAI API key; skipping AI analysis');
      analysis.status = 'completed';
    }
    */

    return json(analysis);
  } catch (error: any) {
    console.error('Error:', error.message, error.status);
    if (error.status === 404) return json({ error: 'Repository not found.' }, { status: 404 });
    if (error.status === 403) return json({ error: 'Private repo requires a valid token.' }, { status: 403 });
    if (error.status === 401) return json({ error: 'Invalid token.' }, { status: 401 });
    return json({ error: 'Analysis failed: ' + error.message }, { status: 500 });
  }
}

async function startAIAnalysis(octokit: Octokit, key: string, owner: string, repo: string) {
  const stored = analysisStore.get(key);
  if (!stored) return;

  try {
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const files = await getAllFiles(octokit, owner, repo);
    console.log('Files found for', key, ':', files.length);

    const fileAnalyses = await analyzeFiles(openai, files);
    stored.fileAnalyses = fileAnalyses;

    const filePaths = files.map(f => f.path.toLowerCase());
    if (!filePaths.some(p => p.endsWith('readme.md'))) stored.suggestions.push('Add a README.md.');
    if (!filePaths.some(p => p.includes('license'))) stored.suggestions.push('Consider adding a license file.');
    if (!filePaths.some(p => p.includes('.gitignore'))) stored.vulnerabilities.push('Add a .gitignore file.');

    stored.status = 'completed';
  } catch (error: any) {
    console.error('AI analysis error for', key, ':', error.message);
    stored.status = 'failed';
    stored.fileAnalyses = []; // Reset on error
  } finally {
    analysisStore.set(key, stored);
  }
}

async function getAllFiles(octokit: Octokit, owner: string, repo: string, path: string = '') {
  const contents = await octokit.rest.repos.getContent({ owner, repo, path });
  const files: { path: string; content: string }[] = [];
  const items = Array.isArray(contents.data) ? contents.data : [contents.data];

  for (const item of items) {
    if (item.type === 'file' && /\.(js|ts|py|java|cpp|c|cs|rb|php)$/i.test(item.name)) {
      const content = await octokit.rest.repos.getContent({ owner, repo, path: item.path });
      if ('content' in content.data) {
        files.push({
          path: item.path,
          content: Buffer.from(content.data.content, 'base64').toString('utf-8'),
        });
      }
    } else if (item.type === 'dir' && !/node_modules|target/.test(item.path)) {
      files.push(...await getAllFiles(octokit, owner, repo, item.path));
    }
  }
  return files;
}

async function analyzeFiles(openai: OpenAI, files: { path: string; content: string }[]) {
  return Promise.all(
    files.map(async (file) => {
      const prompt = `Analyze this code:\n\n${file.content}\n\nReturn JSON: { "good": [], "bad": [], "improvements": [] } with up to 3 points each.`;
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      });
      // Handle case where response might not be valid JSON
      let result;
      try {
        result = JSON.parse(response.choices[0].message.content || '{}');
      } catch (e) {
        console.error('Failed to parse OpenAI response:', e);
        result = { good: [], bad: [], improvements: [] };
      }
      return {
        path: file.path,
        good: result.good || [],
        bad: result.bad || [],
        improvements: result.improvements || [],
        deepAnalysisPending: true,
      };
    })
  );
}