#pragma once

#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class TerrainMesh {
    public:
      std::vector<Vertex> getVertices() { return this->vertices; }
      std::vector<NormText> getNormTexts() { return this->normTexts; }
      std::vector<uint32_t> getIndices() { return this->indices; }

      virtual void convertPointsToMeshes(TerrainPoints* terrainPoints, float worldScale = 1.0f);

    protected:
      std::vector<Vertex> vertices;
      std::vector<NormText> normTexts;
      std::vector<uint32_t> indices;
  };
}