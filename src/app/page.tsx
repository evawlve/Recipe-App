export default function HomePage() {
  return (
    <div>
      <h1>Welcome 👋</h1>
      <p>This is a minimal Next.js + Prisma starter. Try the API routes:</p>
      <ul>
        <li><code>POST /api/upload</code> to get an S3 presigned POST</li>
        <li><code>POST /api/nutrition</code> to compute nutrition from ingredients</li>
        <li><code>POST /api/recipes</code> to create a recipe</li>
        <li><code>GET  /api/recipes</code> to list recipes</li>
      </ul>
    </div>
  );
}
