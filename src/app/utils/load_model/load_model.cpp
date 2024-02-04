#include "load_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define TINYOBJLOADER_IMPLEMENTATION
#include <tiny_obj_loader.h>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace std {
  template <typename T, typename... Rest>
  void hashCombine(std::size_t& seed, const T& v, const Rest&... rest) {
    seed ^= std::hash<T>{}(v) + 0x9e3779b9 + (seed << 6) + (seed >> 2);
    (hashCombine(seed, rest), ...);
  };
  
	template<>
	struct hash<NugieApp::Position> {
		size_t operator () (NugieApp::Position const &position) const {
			size_t seed = 0;
			hashCombine(seed, position.position);
			return seed;
		}
	};
} 

namespace NugieApp {
  LoadedModel loadObjModel(const std::string &filePath, uint32_t materialIndex, uint32_t offsetIndex) {
    LoadedModel loadedModel;
    
    tinyobj::attrib_t attrib;
		std::vector<tinyobj::shape_t> shapes;
		std::vector<tinyobj::material_t> materials;
		std::string warn, err;

		if (!tinyobj::LoadObj(&attrib, &shapes, &materials, &warn, &err, filePath.c_str())) {
			throw std::runtime_error(warn + err);
		}

		std::unordered_map<glm::vec4, uint32_t> uniqueVertices{};
		for (auto &&shape : shapes) {
			uint32_t numTriangle = static_cast<uint32_t>(shape.mesh.indices.size() / 3);

			for (uint32_t i = 0; i < numTriangle; i++) {
				uint32_t vertexIndex0 = shape.mesh.indices[3 * i + 0].vertex_index;
				uint32_t vertexIndex1 = shape.mesh.indices[3 * i + 1].vertex_index;
				uint32_t vertexIndex2 = shape.mesh.indices[3 * i + 2].vertex_index;

				uint32_t normalIndex0 = shape.mesh.indices[3 * i + 0].normal_index;
				uint32_t normalIndex1 = shape.mesh.indices[3 * i + 1].normal_index;
				uint32_t normalIndex2 = shape.mesh.indices[3 * i + 2].normal_index;

				uint32_t texCoordIndex0 = shape.mesh.indices[3 * i + 0].texcoord_index;
				uint32_t texCoordIndex1 = shape.mesh.indices[3 * i + 1].texcoord_index;
				uint32_t texCoordIndex2 = shape.mesh.indices[3 * i + 2].texcoord_index;

				glm::vec4 vertex0{
					attrib.vertices[3 * vertexIndex0 + 0],
					attrib.vertices[3 * vertexIndex0 + 1],
					attrib.vertices[3 * vertexIndex0 + 2],
					1.0f
				};

				glm::vec4 vertex1{
					attrib.vertices[3 * vertexIndex1 + 0],
					attrib.vertices[3 * vertexIndex1 + 1],
					attrib.vertices[3 * vertexIndex1 + 2],
					1.0f
				};

				glm::vec4 vertex2{
					attrib.vertices[3 * vertexIndex2 + 0],
					attrib.vertices[3 * vertexIndex2 + 1],
					attrib.vertices[3 * vertexIndex2 + 2],
					1.0f
				};

				glm::vec4 normal0{
					attrib.normals[3 * normalIndex0 + 0],
					attrib.normals[3 * normalIndex0 + 1],
					attrib.normals[3 * normalIndex0 + 2],
					0.0f
				};

				glm::vec4 normal1{
					attrib.normals[3 * normalIndex1 + 0],
					attrib.normals[3 * normalIndex1 + 1],
					attrib.normals[3 * normalIndex1 + 2],
					0.0f
				};

				glm::vec4 normal2{
					attrib.normals[3 * normalIndex2 + 0],
					attrib.normals[3 * normalIndex2 + 1],
					attrib.normals[3 * normalIndex2 + 2],
					0.0f
				};

				glm::vec2 textCoord0{
					attrib.texcoords[2 * texCoordIndex0 + 0],
					1.0f - attrib.texcoords[2 * texCoordIndex0 + 1]
				};

				glm::vec2 textCoord1{
					attrib.texcoords[2 * texCoordIndex1 + 0],
					1.0f - attrib.texcoords[2 * texCoordIndex1 + 1]
				};

				glm::vec2 textCoord2{
					attrib.texcoords[2 * texCoordIndex2 + 0],
					1.0f - attrib.texcoords[2 * texCoordIndex2 + 1]
				};

				if (uniqueVertices.count(vertex0) == 0) {
					uniqueVertices[vertex0] = static_cast<uint32_t>(loadedModel.positions.size());

					loadedModel.positions.push_back(vertex0);
					loadedModel.normals.push_back(normal0);
					loadedModel.textCoords.push_back(textCoord0);
				}

				if (uniqueVertices.count(vertex1) == 0) {
					uniqueVertices[vertex1] = static_cast<uint32_t>(loadedModel.positions.size());

					loadedModel.positions.push_back(vertex1);
					loadedModel.normals.push_back(normal1);
					loadedModel.textCoords.push_back(textCoord1);
				}

				if (uniqueVertices.count(vertex2) == 0) {
					uniqueVertices[vertex2] = static_cast<uint32_t>(loadedModel.positions.size());

					loadedModel.positions.push_back(vertex2);
					loadedModel.normals.push_back(normal2);
					loadedModel.textCoords.push_back(textCoord2);
				}

				loadedModel.indices.push_back(uniqueVertices[vertex0]);
				loadedModel.indices.push_back(uniqueVertices[vertex1]);
				loadedModel.indices.push_back(uniqueVertices[vertex2]);

				loadedModel.primitives.emplace_back(Primitive{
					glm::uvec3 {
						uniqueVertices[vertex0] + offsetIndex,
						uniqueVertices[vertex1] + offsetIndex,
						uniqueVertices[vertex2] + offsetIndex
					}, 
					materialIndex
				});
			}
		}

    return loadedModel;
  }
}