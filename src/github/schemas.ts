// Add after the existing SearchGistsSchema

// Schema for creating a gist file
export const CreateGistFileSchema = z.object({
  content: z.string().describe("The content of the file"),
  filename: z.string().describe("The name of the file")
});

// Schema for creating a gist
export const CreateGistSchema = z.object({
  description: z.string().optional().describe("Description of the gist"),
  public: z.boolean().default(true).describe("Whether the gist is public"),
  files: z.record(CreateGistFileSchema).describe("Files to include in the gist")
});

export type CreateGistFile = z.infer<typeof CreateGistFileSchema>;
export type CreateGist = z.infer<typeof CreateGistSchema>;
