#pragma once

#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class TerrainMesh {
    public:
      TerrainMesh(TerrainPoints* terrainPoints, float worldScale = 1.0f);

      std::vector<Vertex> getVertices() { return this->vertices; }
      std::vector<NormText> getNormTexts() { return this->normTexts; }
      std::vector<uint32_t> getIndices() { return this->indices; }

    private:
      std::vector<Vertex> vertices;
      std::vector<NormText> normTexts;
      std::vector<uint32_t> indices;

      void generateIndices(TerrainPoints* terrainPoints, float worldScale);
      void generateVertices(TerrainPoints* terrainPoints, float worldScale);
      void generateTextureCoordinates(TerrainPoints* terrainPoints, float worldScale);
      void generateNormals(TerrainPoints* terrainPoints, float worldScale);

      void addTriangle(uint32_t index0, uint32_t index1, uint32_t index2);
  };
}