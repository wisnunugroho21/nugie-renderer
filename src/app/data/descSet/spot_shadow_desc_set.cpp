#include "spot_shadow_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  SpotShadowDescSet::SpotShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]) 
		: device{device}, descriptorPool{descriptorPool}
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(modelsInfo);
  }

	SpotShadowDescSet::~SpotShadowDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void SpotShadowDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.build();
	}

  void SpotShadowDescSet::createDescriptorSet(VkDescriptorBufferInfo modelsInfo[2])  
	{
		this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeBuffer(0, modelsInfo[0])
				.writeBuffer(1, modelsInfo[1])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
	}

	void SpotShadowDescSet::recreateDescriptorSet(VkDescriptorBufferInfo modelsInfo[2]) {
		this->descriptorPool->free(this->descriptorSets);
		this->createDescriptorSet(modelsInfo);
	}
}