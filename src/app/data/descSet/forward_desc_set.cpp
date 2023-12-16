#include "forward_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ForwardDescSet::ForwardDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], VkDescriptorBufferInfo modelsInfo[1])
		: device{device}, descriptorPool{descriptorPool} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(uniformBufferInfo, modelsInfo);
  }

	ForwardDescSet::~ForwardDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void ForwardDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.build();
	}

  void ForwardDescSet::createDescriptorSet(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
		VkDescriptorBufferInfo modelsInfo[1]) 
	{	
		this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, uniformBufferInfo[0][i])
				.writeBuffer(1, modelsInfo[0])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void ForwardDescSet::deleteDescriptorSet() {
		this->descriptorPool->free(this->descriptorSets);
	}
}