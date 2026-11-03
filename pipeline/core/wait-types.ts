export interface WaitTarget { repository: string; commit: string }
export interface WaitJob { name: string; conclusion: string | null; url: string }
export interface WaitRun {
	id: number;
	attempt: number;
	name: string;
	status: string;
	conclusion: string | null;
	url: string;
	failedJobs?: WaitJob[];
	jobsError?: string;
}
export const successfulConclusion = (conclusion: string | null) => conclusion !== null && ["success", "skipped", "neutral"].includes(conclusion);
