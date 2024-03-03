#include "terrain_mesh.hpp"

namespace NugieApp {
	TerrainMesh TerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints) {
		TerrainMesh terrainMesh{};

		float textureTerrainScale = static_cast<float>(floor(terrainPoints->getSize() / 100));

		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float y = terrainPoints->get(x, z);

				Vertex vertex{};
				vertex.position = glm::vec4 { x, y * -1.0f, z, 1.0f };

				float tSize = static_cast<float>(terrainPoints->getSize());

				NormText normText{};
				normText.textCoord = glm::vec2 { static_cast<float>(x) / tSize * textureTerrainScale, static_cast<float>(z) / tSize * textureTerrainScale };

				terrainMesh.vertices.emplace_back(vertex);
				terrainMesh.normTexts.emplace_back(normText);
			}
		}

		for (int z = 0; z < terrainPoints->getSize() - 1; z++) {
			for (int x = 0; x < terrainPoints->getSize() - 1; x++) {
				uint32_t indexBottomLeft = z * terrainPoints->getSize() + x;
				uint32_t indexTopLeft = (z + 1) * terrainPoints->getSize() + x;
				uint32_t indexTopRight = (z + 1) * terrainPoints->getSize() + x + 1;
				uint32_t indexBottomRight = z * terrainPoints->getSize() + x + 1;

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

  TerrainMesh TerrainMesh::convertPointsToMeshes(std::vector<float> terrainPoints) {
		TerrainMesh terrainMesh;

		int terrainSize = static_cast<int>(sqrtf(terrainPoints.size()));
		terrainMesh.vertices.clear();
		terrainMesh.indices.clear();

		for (int z = 0; z < terrainSize; z++) {
			for (int x = 0; x < terrainSize; x++) {
				float y = terrainPoints[x + terrainSize * z];

				Vertex vertex{};
				vertex.position = glm::vec4 { x, y * -1.0f, z, 1.0f };

				NormText normText{};
				normText.textCoord = glm::vec2 { x / terrainSize, z / terrainSize };

				terrainMesh.vertices.emplace_back(vertex);
				terrainMesh.normTexts.emplace_back(normText);
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