#include "primitive_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

namespace NugieApp {
	PrimitiveModel::PrimitiveModel(NugieVulkan::Device* device) : device{device} {
		this->createPrimitiveBuffers();
		this->createBvhBuffers();
	}

	PrimitiveModel::~PrimitiveModel() {
		if (this->bvhStagingBuffer != nullptr) delete this->bvhStagingBuffer;
		if (this->bvhBuffer != nullptr) delete this->bvhBuffer;

		if (this->primitiveStagingBuffer != nullptr) delete this->primitiveStagingBuffer;
		if (this->primitiveBuffer != nullptr) delete this->primitiveBuffer;
	}

	void PrimitiveModel::addPrimitive(std::vector<Primitive> primitives, std::vector<glm::vec4> positions) {
		auto curBvhNodes = this->createBvhData(primitives, positions);

		for (int i = 0; i < curBvhNodes.size(); i++) {
			this->bvhNodes.emplace_back(curBvhNodes[i]);
		}

		for (int i = 0; i < primitives.size(); i++) {
			this->primitives.emplace_back(primitives[i]);
		}
	}

	void PrimitiveModel::clearPrimitive() {
		this->primitives.clear();
		this->bvhNodes.clear();
	}

	std::vector<BvhNode> PrimitiveModel::createBvhData(std::vector<Primitive> primitives, std::vector<glm::vec4> positions) {
		std::vector<BoundBox*> boundBoxes;
		for (uint32_t i = 0; i < primitives.size(); i++) {
			boundBoxes.push_back(new PrimitiveBoundBox(i + 1, &primitives[i], positions));
		}

		return createBvh(boundBoxes);
	}

	void PrimitiveModel::createPrimitiveBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(Primitive));

		this->primitiveStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->primitiveBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void PrimitiveModel::createBvhBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(BvhNode));

		this->bvhStagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->bvhBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void PrimitiveModel::updatePrimitiveBuffers(NugieVulkan::CommandBuffer* commandBuffer) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(Primitive)) * static_cast<VkDeviceSize>(this->primitives.size());

		this->primitiveStagingBuffer->map();
		this->primitiveStagingBuffer->writeToBuffer((void *) this->primitives.data(), bufferSize);
		
		this->primitiveBuffer->copyFromAnotherBuffer(commandBuffer, this->primitiveStagingBuffer, bufferSize);
	}

	void PrimitiveModel::updateBvhBuffers(NugieVulkan::CommandBuffer* commandBuffer) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(BvhNode)) * static_cast<VkDeviceSize>(this->bvhNodes.size());

		this->bvhStagingBuffer->map();
		this->bvhStagingBuffer->writeToBuffer((void *) this->primitives.data(), bufferSize);
		
		this->bvhBuffer->copyFromAnotherBuffer(commandBuffer, this->bvhStagingBuffer, bufferSize);
	}
} // namespace NugieApp

