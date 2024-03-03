#include "terrain_mesh.hpp"

namespace NugieApp {
	TerrainMesh TerrainMesh::convertPointsToMeshes(TerrainPoints* terrainPoints, float worldScale) {
		TerrainMesh terrainMesh{};

		float textureTerrainScale = static_cast<float>(floor(terrainPoints->getSize() / 100));

		for (uint32_t z = 0; z < terrainPoints->getSize() - 1; z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize() - 1; x++) {
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

		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float y = terrainPoints->get(x, z);

				Vertex vertex{};
				vertex.position = glm::vec4 { x * worldScale, y * -1.0f, z * worldScale, 1.0f };

				terrainMesh.vertices.emplace_back(vertex);
			}
		}

		for (uint32_t z = 0; z < terrainPoints->getSize(); z++) {
			for (uint32_t x = 0; x < terrainPoints->getSize(); x++) {
				float tSize = static_cast<float>(terrainPoints->getSize());

				NormText normText{};
				normText.textCoord = glm::vec2 { static_cast<float>(x) / tSize * textureTerrainScale, static_cast<float>(z) / tSize * textureTerrainScale };
				normText.normal = glm::vec4{ 0.0f };

				terrainMesh.normTexts.emplace_back(normText);
			}
		}

		for (size_t i = 0; i < terrainMesh.indices.size(); i += 3) {
			uint32_t index0 = terrainMesh.indices[i];
			uint32_t index1 = terrainMesh.indices[i + 1];
			uint32_t index2 = terrainMesh.indices[i + 2];

			glm::vec3 vertexPosition0 = glm::vec3(terrainMesh.vertices[index0].position);
			glm::vec3 vertexPosition1 = glm::vec3(terrainMesh.vertices[index1].position);
			glm::vec3 vertexPosition2 = glm::vec3(terrainMesh.vertices[index2].position);

			glm::vec3 edgeV0toV1 = vertexPosition1 - vertexPosition0;
			glm::vec3 edgeV0toV2 = vertexPosition2 - vertexPosition0;

			glm::vec3 totalNormal = glm::cross(edgeV0toV1, edgeV0toV2);
			if (totalNormal.y < 0) {
				totalNormal *= -1.0f;
			}

			terrainMesh.normTexts[index0].normal += glm::vec4{ totalNormal, 0.0f };
			terrainMesh.normTexts[index1].normal += glm::vec4{ totalNormal, 0.0f };
			terrainMesh.normTexts[index2].normal += glm::vec4{ totalNormal, 0.0f };
		}

		for (size_t i = 0; i < terrainMesh.normTexts.size(); i++) {
			terrainMesh.normTexts[i].normal = glm::normalize(terrainMesh.normTexts[i].normal);
		}
		
		return terrainMesh;
	}
}