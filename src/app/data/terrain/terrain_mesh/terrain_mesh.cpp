#include "terrain_mesh.hpp"

namespace NugieApp {
  TerrainMesh TerrainMesh::convertPointsToMeshes(std::vector<float> terrainPoints) {
		TerrainMesh terrainMesh;

		int terrainSize = static_cast<int>(sqrtf(terrainPoints.size()));
		terrainMesh.positions.clear();
		terrainMesh.indices.clear();

		for (int z = 0; z < terrainSize; z++) {
			for (int x = 0; x < terrainSize; x++) {
				float y = terrainPoints[x + terrainSize * z];

				Position position{};
				position.position = glm::vec4 { x, y * -1.0f, z, 1.0f };

				terrainMesh.positions.emplace_back(position);
			}
		}

		for (int z = 0; z < terrainSize - 1; z++) {
			for (int x = 0; x < terrainSize - 1; x++) {
				uint32_t indexBottomLeft = z * terrainSize + x;
				uint32_t indexTopLeft = (z + 1) * terrainSize + x;
				uint32_t indexTopRight = (z + 1) * terrainSize + x + 1;
				uint32_t indexBottomRight = z * terrainSize + x + 1;

				terrainMesh.indices.emplace_back(indexBottomLeft);
				terrainMesh.indices.emplace_back(indexTopLeft);
				terrainMesh.indices.emplace_back(indexTopRight);

				terrainMesh.indices.emplace_back(indexBottomLeft);
				terrainMesh.indices.emplace_back(indexTopRight);
				terrainMesh.indices.emplace_back(indexBottomRight);
			}
		}
		
		return terrainMesh;
  }
}